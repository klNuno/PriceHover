import { mount, unmount } from 'svelte';
import { convertPrice } from '../src/convert';
import { detectPricesFromElement, detectPriceFromText, setCryptoDetection } from '../src/detector';
import { createInlineAnnotator, INLINE_ATTR } from '../src/inline';
import { makeTokenResolver } from '../src/locale';
import type { TokenResolver } from '../src/locale';
import { MESSAGE, send } from '../src/messages';
import type { RefreshResult } from '../src/messages';
import { isCryptoCode } from '../src/crypto';
import { parseCryptoTable, parseRates } from '../src/rates';
import { isActiveOn, loadSettings, wantsCrypto, watchSettings } from '../src/settings';
import type { Settings } from '../src/settings';
import Tooltip from '../src/tooltip.svelte';
import { getCardRect, hideTooltipState, moveTooltipState, showTooltipState } from '../src/tooltip-state';
import tooltipStyles from '../src/tooltip.css?inline';
import {
  CACHE_DURATION_MS, CRYPTO_CACHE_MS, CRYPTO_STALE_AFTER_MS, STALE_AFTER_MS, STORAGE,
} from '../src/types';
import type { ConvertedPrice, DetectedPrice, ExchangeRates } from '../src/types';

const E = (msg: string, err: unknown) => console.error(`[PH] ${msg}`, err);

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  async main() {
    if (!document.body) return;

    const hostname = location.hostname;
    let settings = await loadSettings();
    // A page written in crypto is only read as such once the user asked for it.
    setCryptoDetection(settings.cryptoEnabled);

    // ── Rates ────────────────────────────────────────────────────────────────
    // Fetched on first need, not on page load. Most pages are never hovered,
    // and a storage read per page for rates nobody asked for is a page-load
    // cost paid on every site the user visits.

    /**
     * Two tables from two hosts on two clocks, merged into the one table every
     * other module reads. Crypto wins a key collision, which is why what goes
     * into it is filtered to known assets on the way out of storage.
     */
    let fiatRates: ExchangeRates | null = null;
    let cryptoRates: ExchangeRates | null = null;
    let rates: ExchangeRates | null = null;
    let ratesTimestamp = 0;
    let cryptoTimestamp = 0;
    let ratesPromise: Promise<void> | null = null;

    function mergeRates(): void {
      if (!fiatRates) { rates = null; return; }
      rates = cryptoRates ? { ...fiatRates, ...cryptoRates } : fiatRates;
    }

    /** How long to leave a failed refresh alone before asking again. */
    const RETRY_AFTER_MS = 60_000;
    let lastFailure = 0;
    let lastCryptoFailure = 0;

    /**
     * The fetch itself belongs to the background, and asking for it is all this
     * script does. A fetch issued from a content script carries the visited
     * page's origin, which would hand open.er-api.com the address of every page
     * a price was hovered on, and it runs under the page's own CSP, so a site
     * with a strict `connect-src` blocked it outright and left the tooltip
     * empty. PRIVACY.md promises neither of those, and the background has both
     * the host permission and no page to answer to.
     */
    async function requestRefresh(): Promise<void> {
      // A rate endpoint that is down must not turn a page of prices into one
      // message per hover.
      if (Date.now() - lastFailure < RETRY_AFTER_MS) return;

      try {
        const result = await send<RefreshResult>(MESSAGE.REFRESH_RATES);
        if (!result?.ok) { lastFailure = Date.now(); return; }
        await readStoredRates();
      } catch (err) {
        lastFailure = Date.now();
        E('rate refresh failed', err);
      }
    }

    /** Same shape as the fiat refresh, and a failure counted separately: one
     * host being down must not stop the other from being asked. */
    async function requestCryptoRefresh(): Promise<void> {
      if (Date.now() - lastCryptoFailure < RETRY_AFTER_MS) return;

      try {
        const result = await send<RefreshResult>(MESSAGE.REFRESH_CRYPTO);
        // Skipped is not failed: the switch is off, or the permission is gone.
        // A timed backoff would be wrong in both directions, so this stops
        // asking entirely until a settings change says the answer may differ.
        if (result?.skipped) { cryptoUnavailable = true; return; }
        if (!result?.ok) { lastCryptoFailure = Date.now(); return; }
        await readStoredRates();
      } catch (err) {
        lastCryptoFailure = Date.now();
        E('crypto rate refresh failed', err);
      }
    }

    async function readStoredRates(): Promise<void> {
      const stored = await chrome.storage.local.get([
        STORAGE.RATES, STORAGE.RATES_TS, STORAGE.CRYPTO_RATES, STORAGE.CRYPTO_TS,
      ]);

      const parsed = parseRates(stored?.[STORAGE.RATES]);
      if (parsed) {
        fiatRates = parsed;
        const ts = stored?.[STORAGE.RATES_TS];
        ratesTimestamp = typeof ts === 'number' ? ts : 0;
      }

      // Null clears: a revoked permission wipes the stored table, and a tab
      // open at that moment must stop showing what it can no longer refresh.
      cryptoRates = parseCryptoTable(stored?.[STORAGE.CRYPTO_RATES]);
      const cryptoTs = stored?.[STORAGE.CRYPTO_TS];
      cryptoTimestamp = typeof cryptoTs === 'number' ? cryptoTs : 0;

      mergeRates();
    }

    function ensureRates(): Promise<void> {
      if (!ratesPromise) {
        ratesPromise = (async () => {
          try {
            await readStoredRates();
            if (!rates || ratesAge() > CACHE_DURATION_MS) await requestRefresh();
            if (cryptoNeeded()) await requestCryptoRefresh();
          } catch {
            if (!rates) await requestRefresh();
          }
        })().finally(() => { ratesPromise = null; });
      }
      return ratesPromise;
    }

    /**
     * A page priced in crypto needs the rate as much as a crypto row does, and
     * the target list says nothing about it: `0.05 BTC` on a page converts into
     * a euro row for a user who never added a crypto target. Detection follows
     * the switch, so the rates have to follow detection, and this latch is what
     * carries that across the two paths that find a price.
     *
     * Still nothing at rest: the latch is only ever set by a price already
     * found on this page, so a session that meets none makes no request.
     */
    let cryptoSourceSeen = false;

    /** Set when the background says it will not ask, cleared by a settings change. */
    let cryptoUnavailable = false;

    function cryptoNeeded(): boolean {
      if (!settings.cryptoEnabled || cryptoUnavailable) return false;
      if (!wantsCrypto(settings) && !cryptoSourceSeen) return false;
      return !cryptoRates || cryptoAge() > CRYPTO_CACHE_MS;
    }

    /** A crypto price we hold no rate for is the one thing that sets the latch. */
    function notePrice(code: string): boolean {
      if (!isCryptoCode(code) || rates?.[code]) return false;
      cryptoSourceSeen = true;
      return true;
    }

    /**
     * Absolute, because a clock set back leaves a timestamp in the future.
     * Signed arithmetic made that look infinitely fresh, so the rates were never
     * refreshed again and nothing warned about it either.
     */
    const ratesAge = (): number => Math.abs(Date.now() - ratesTimestamp);
    const ratesAreStale = (): boolean => ratesAge() > STALE_AFTER_MS;
    const cryptoAge = (): number => Math.abs(Date.now() - cryptoTimestamp);

    /**
     * A crypto row an hour old is not the same claim as a euro row an hour old,
     * so the warning is decided per row rather than once for the tooltip. The
     * fiat table being fresh says nothing about the other host.
     */
    function anyStale(conversions: readonly ConvertedPrice[]): boolean {
      if (ratesAreStale()) return true;
      return conversions.some((c) => isCryptoCode(c.currency.code)) &&
             cryptoAge() > CRYPTO_STALE_AFTER_MS;
    }

    // ── Currency resolution from the page ────────────────────────────────────

    let resolver: TokenResolver | undefined;
    function refreshResolver(): void {
      resolver = settings.usePageContext
        ? makeTokenResolver(hostname, document.documentElement.lang || '') ?? undefined
        : undefined;
    }
    refreshResolver();

    // ── Tooltip host, built on first use ─────────────────────────────────────
    // 60 kB of Svelte and a shadow root used to be mounted into every page the
    // user opened, price or no price.

    let host: HTMLDivElement | null = null;
    let tooltipInstance: ReturnType<typeof mount> | null = null;

    function ensureTooltip(): HTMLDivElement {
      // Not just "built once": an SPA that replaces document.body takes the
      // host with it, and the tooltip then updated state nothing rendered.
      if (host?.isConnected) return host;
      if (host) destroyTooltipHost();

      host = document.createElement('div');
      host.id = 'pricehover-root';
      host.setAttribute(INLINE_ATTR, '1');
      host.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:2147483647;';
      const shadow = host.attachShadow({ mode: 'closed' });

      const style = document.createElement('style');
      style.textContent = tooltipStyles;
      shadow.appendChild(style);

      const container = document.createElement('div');
      shadow.appendChild(container);
      document.body.appendChild(host);

      tooltipInstance = mount(Tooltip, { target: container });
      return host;
    }

    function destroyTooltipHost(): void {
      if (tooltipInstance) { unmount(tooltipInstance); tooltipInstance = null; }
      host?.remove();
      host = null;
    }

    // ── Detection cache ──────────────────────────────────────────────────────

    interface CachedDetection { text: string; prices: DetectedPrice[] }
    // Keyed on the element's text alone, so the resolver and the currency list
    // are not part of it. Changing either has to throw the whole thing away.
    let detectionCache = new WeakMap<Element, CachedDetection>();

    function detectWithCache(element: Element): DetectedPrice[] {
      const text = element.textContent ?? '';
      const cached = detectionCache.get(element);
      if (cached && cached.text === text) return cached.prices;

      const prices = detectPricesFromElement(element, resolver);
      detectionCache.set(element, { text, prices });
      return prices;
    }

    // ── Hitboxes ─────────────────────────────────────────────────────────────

    const MIN_HITBOX = 6;
    /** How far outside a rect the pointer may stray and still count as on it. */
    const HIT_PAD = 4;
    /** The gap between price and card, which the pointer has to cross to click. */
    const BRIDGE = 12;

    interface PriceHitbox {
      price: DetectedPrice;
      /** Re-measured on scroll: client rects are viewport-relative. */
      measure: () => DOMRect[];
      rects: DOMRect[];
    }

    interface TextSegment { node: Text; start: number; end: number }

    let activeElement: Element | null = null;
    let hitboxes: PriceHitbox[] = [];
    let activeIndex = -1;
    let lastPointer = { x: 0, y: 0 };
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    let moveRaf: number | null = null;
    let viewportRaf: number | null = null;
    let selectionRaf: number | null = null;

    function usableRects(rects: DOMRect[]): DOMRect[] {
      return rects.filter((r) => r.width >= MIN_HITBOX && r.height >= MIN_HITBOX);
    }

    function collectSegments(element: Element, directOnly: boolean): TextSegment[] {
      const segments: TextSegment[] = [];
      let offset = 0;

      const push = (node: Node): void => {
        const content = node.textContent ?? '';
        if (!content.length) return;
        segments.push({ node: node as Text, start: offset, end: offset + content.length });
        offset += content.length;
      };

      if (directOnly) {
        for (const node of element.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) push(node);
        }
        return segments;
      }

      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) push(node);
      return segments;
    }

    function buildHitboxes(element: Element, prices: DetectedPrice[]): PriceHitbox[] {
      const positional = prices.filter(
        (p): p is DetectedPrice & { matchStart: number; matchEnd: number; textSource: 'full' | 'direct' } =>
          typeof p.matchStart === 'number' &&
          typeof p.matchEnd === 'number' &&
          (p.textSource === 'full' || p.textSource === 'direct')
      );
      if (!positional.length) return [];

      const segments = collectSegments(element, positional[0].textSource === 'direct');
      if (!segments.length) return [];

      const result: PriceHitbox[] = [];
      let index = 0;

      for (const price of positional) {
        while (index < segments.length && segments[index].end <= price.matchStart) index++;
        if (index >= segments.length) break;

        const startSegment = segments[index];
        if (price.matchStart < startSegment.start || price.matchStart > startSegment.end) continue;

        let endIndex = index;
        while (endIndex < segments.length && segments[endIndex].end < price.matchEnd) endIndex++;
        if (endIndex >= segments.length) break;

        const endSegment = segments[endIndex];
        if (price.matchEnd < endSegment.start || price.matchEnd > endSegment.end) continue;

        const range = document.createRange();
        range.setStart(startSegment.node, price.matchStart - startSegment.start);
        range.setEnd(endSegment.node, price.matchEnd - endSegment.start);

        // The Range is kept, not just its rects: scrolling moves the price and
        // the tooltip has to follow it rather than vanish.
        const measure = () => usableRects([...range.getClientRects()]);
        const rects = measure();
        if (rects.length) result.push({ price, measure, rects });
        index = endIndex;
      }
      return result;
    }

    /** Index of the hitbox under the pointer, and which of its rects. */
    function hitTest(x: number, y: number): { index: number; rect: DOMRect } | null {
      for (let i = 0; i < hitboxes.length; i++) {
        for (const rect of hitboxes[i].rects) {
          if (x >= rect.left - HIT_PAD && x <= rect.right + HIT_PAD &&
              y >= rect.top - HIT_PAD && y <= rect.bottom + HIT_PAD) {
            return { index: i, rect };
          }
        }
      }
      return null;
    }

    function withinCard(x: number, y: number): boolean {
      const rect = getCardRect();
      if (!rect || rect.width === 0) return false;
      return x >= rect.left - BRIDGE && x <= rect.right + BRIDGE &&
             y >= rect.top - BRIDGE && y <= rect.bottom + BRIDGE;
    }

    // ── Showing ──────────────────────────────────────────────────────────────

    /** A hover that landed before the rates did, replayed once they arrive. */
    let pending: { price: DetectedPrice; rect: DOMRect } | null = null;

    function show(price: DetectedPrice, rect: DOMRect): void {
      // A price in an asset we hold no rate for is worth waiting for, exactly
      // like the first hover of a session: the alternative is a tooltip that
      // never appears and never says why.
      const unpriced = notePrice(price.currencyCode);

      // A tab left open for a week converted at week-old rates: the staleness
      // check only ever ran when there were no rates at all.
      if (rates && !unpriced && (ratesAge() > CACHE_DURATION_MS || cryptoNeeded())) void ensureRates();

      if (!rates || unpriced) {
        pending = { price, rect };
        ensureRates().then(() => {
          const queued = pending;
          pending = null;
          // Not `rates` alone: a crypto refresh that failed leaves the fiat
          // table in place, and replaying the hover would only hide again.
          if (queued && rates?.[queued.price.currencyCode]) show(queued.price, queued.rect);
        });
        return;
      }

      pending = null;
      const conversions = convertPrice(price, rates, displayList(), settings.rounding);
      // Nothing to say is not the same as an empty tooltip: a rate table that
      // does not know this currency should stay silent.
      if (!conversions.length) { hide(); return; }

      ensureTooltip();
      showTooltipState({
        sources: [price],
        allConversions: [conversions],
        rounding: settings.rounding,
        stale: anyStale(conversions),
        x: rect.left + rect.width / 2,
        y: rect.top,
        yBottom: rect.bottom,
      });
    }

    function hide(): void {
      pending = null;
      hideTooltipState();
    }

    function displayList(): string[] {
      return [settings.baseCurrency, ...settings.targetCurrencies];
    }

    function isOwnCurrency(price: DetectedPrice): boolean {
      return price.currencyCode === settings.baseCurrency ||
             settings.targetCurrencies.includes(price.currencyCode);
    }

    // ── Pointer ──────────────────────────────────────────────────────────────

    function clearHover(): void {
      if (hoverTimer !== null) { clearTimeout(hoverTimer); hoverTimer = null; }
      if (moveRaf !== null) { cancelAnimationFrame(moveRaf); moveRaf = null; }
      document.removeEventListener('mousemove', onMouseMove);
      activeElement = null;
      hitboxes = [];
      activeIndex = -1;
    }

    function arm(target: Element, x: number, y: number): void {
      try {
        let priceEl: Element = target;
        let found = detectWithCache(target);
        if (!found.length && target.parentElement && target.parentElement !== host) {
          const parentPrices = detectWithCache(target.parentElement);
          if (parentPrices.length) { found = parentPrices; priceEl = target.parentElement; }
        }

        const prices = found.filter((p) => !isOwnCurrency(p));
        if (!prices.length) { hide(); return; }

        activeElement = priceEl;
        hitboxes = buildHitboxes(priceEl, prices);

        // Semantic detection (itemprop, data-price) reports no text offsets, so
        // it produces no range. Without this fallback those prices build no
        // hitbox and silently never show a tooltip.
        if (!hitboxes.length && prices[0].matchStart === undefined) {
          const measure = () => usableRects([...priceEl.getClientRects()]);
          const rects = measure();
          if (rects.length) hitboxes = [{ price: prices[0], measure, rects }];
        }
        if (!hitboxes.length) { activeElement = null; return; }

        document.addEventListener('mousemove', onMouseMove, { passive: true });

        const hit = hitTest(x, y);
        if (hit) {
          activeIndex = hit.index;
          show(hitboxes[hit.index].price, hit.rect);
        }
      } catch (err) {
        E('arm failed', err);
        clearHover();
        hide();
      }
    }

    function onMouseOver(e: MouseEvent): void {
      const target = e.target as Element | null;
      if (!target || target === host) return;

      // Inside the element we already armed: mousemove owns the decision.
      if (activeElement && (target === activeElement || activeElement.contains(target))) return;

      // Crossing the gap towards the tooltip. The pointer leaves the price and
      // passes over its container, whose mouseover would otherwise clear the
      // hover and take the tooltip away before it can be clicked. mousemove and
      // mouseout already make that exception; this is the third way in.
      if (activeIndex !== -1 && withinCard(e.clientX, e.clientY)) return;

      if (hoverTimer !== null) clearTimeout(hoverTimer);
      if (activeElement) clearHover();

      const { clientX: x, clientY: y } = e;
      lastPointer = { x, y };

      // Hover intent. Everything expensive (textContent, the regex, building
      // ranges) happens here and nowhere else, so sweeping the pointer across
      // a page of prices costs nothing at all.
      const delay = settings.hoverDelayMs;
      if (delay <= 0) { arm(target, x, y); return; }
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        if (target.isConnected) arm(target, x, y);
      }, delay);
    }

    function onMouseMove(e: MouseEvent): void {
      lastPointer = { x: e.clientX, y: e.clientY };
      if (moveRaf !== null) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = null;
        const { x, y } = lastPointer;
        const hit = hitTest(x, y);

        if (!hit) {
          // The pointer may be crossing the gap towards a tooltip it is allowed
          // to click. Losing the tooltip halfway there would make copy useless.
          if (activeIndex !== -1 && withinCard(x, y)) return;
          if (activeIndex === -1) return;
          activeIndex = -1;
          hide();
          return;
        }

        if (hit.index === activeIndex) return;
        activeIndex = hit.index;
        show(hitboxes[hit.index].price, hit.rect);
      });
    }

    function onMouseOut(e: MouseEvent): void {
      if (hoverTimer !== null) { clearTimeout(hoverTimer); hoverTimer = null; }

      const related = e.relatedTarget as Element | null;
      // Moving onto the tooltip itself, or deeper into the armed element.
      if (related && (related === host || (activeElement && activeElement.contains(related)))) return;
      // Where the pointer went, not where it was. mouseout fires before the
      // mousemove that updates lastPointer, so the old reading was still inside
      // the price: a pointer moving fast enough to clear the gap in one sample
      // lost the tooltip on the way to clicking it.
      if (related && withinCard(e.clientX, e.clientY)) return;

      clearHover();
      hide();
    }

    // ── Viewport ─────────────────────────────────────────────────────────────

    function onViewportChange(): void {
      if (hoverTimer !== null) { clearTimeout(hoverTimer); hoverTimer = null; }
      if (!hitboxes.length) return;
      if (viewportRaf !== null) return;

      viewportRaf = requestAnimationFrame(() => {
        viewportRaf = null;
        // Scrolling used to hide the tooltip outright, so a nudge of the wheel
        // while reading a price made it disappear until the pointer left the
        // element and came back. The price moved; follow it.
        for (const box of hitboxes) box.rects = box.measure();

        if (activeIndex === -1) return;
        const rects = hitboxes[activeIndex]?.rects ?? [];
        if (!rects.length) { activeIndex = -1; hide(); return; }

        const rect = rects.find((r) => r.bottom > 0 && r.top < window.innerHeight) ?? rects[0];
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) { activeIndex = -1; hide(); return; }

        moveTooltipState(rect.left + rect.width / 2, rect.top, rect.bottom);
      });
    }

    // ── Selection ────────────────────────────────────────────────────────────

    function onSelectionChange(): void {
      if (selectionRaf !== null) cancelAnimationFrame(selectionRaf);
      selectionRaf = requestAnimationFrame(() => {
        selectionRaf = null;
        try {
          const selection = window.getSelection();
          if (!selection || selection.isCollapsed) return;

          const text = selection.toString().trim();
          if (!text || text.length > 120) return;

          const detected = detectPriceFromText(text, resolver);
          if (!detected || isOwnCurrency(detected)) return;

          const rect = selection.getRangeAt(0).getBoundingClientRect();
          if (!rect.width && !rect.height) return;

          clearHover();
          show(detected, rect);
        } catch (err) {
          E('selection handling failed', err);
        }
      });
    }

    // ── Inline mode ──────────────────────────────────────────────────────────

    let annotator: ReturnType<typeof createInlineAnnotator> | null = null;

    function syncInlineMode(): void {
      if (settings.inlineMode && !annotator) {
        annotator = createInlineAnnotator({
          settings: () => settings,
          rates: () => rates,
          resolver: () => resolver,
          // Inline never hovers anything, so this is its only way of saying it
          // met a crypto price. The refresh that follows re-runs the pass.
          onUnpriced: (code) => { if (notePrice(code)) void ensureRates(); },
        });
        // Inline mode is the one path that needs rates before any interaction.
        ensureRates().then(() => annotator?.refresh());
      } else if (!settings.inlineMode && annotator) {
        annotator.destroy();
        annotator = null;
      } else {
        annotator?.refresh();
      }
    }

    // ── Wiring ───────────────────────────────────────────────────────────────

    let listening = false;

    function startListening(): void {
      if (listening) return;
      listening = true;
      document.addEventListener('mouseover', onMouseOver, { passive: true });
      document.addEventListener('mouseout', onMouseOut, { passive: true });
      document.addEventListener('selectionchange', onSelectionChange, { passive: true });
      document.addEventListener('scroll', onViewportChange, { passive: true, capture: true });
      window.addEventListener('resize', onViewportChange, { passive: true });
      syncInlineMode();
    }

    function stopListening(): void {
      if (!listening) return;
      listening = false;
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
      if (selectionRaf !== null) { cancelAnimationFrame(selectionRaf); selectionRaf = null; }
      if (viewportRaf !== null) { cancelAnimationFrame(viewportRaf); viewportRaf = null; }
      clearHover();
      hide();
      annotator?.destroy();
      annotator = null;
      destroyTooltipHost();
    }

    function applySettings(next: Settings): void {
      const wasActive = isActiveOn(settings, hostname);
      settings = next;
      refreshResolver();
      setCryptoDetection(settings.cryptoEnabled);
      // The switch or the permission may be what changed, so the refusal the
      // background gave last time no longer stands.
      cryptoUnavailable = false;

      const active = isActiveOn(settings, hostname);
      if (!active) { stopListening(); return; }

      if (!wasActive) { startListening(); return; }

      // A changed resolver or currency list invalidates every cached detection.
      detectionCache = new WeakMap();
      clearHover();
      hide();
      syncInlineMode();
    }

    const unwatch = watchSettings(applySettings);

    const onRatesChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area !== 'local') return;
      if (changes[STORAGE.RATES]) {
        const next = parseRates(changes[STORAGE.RATES].newValue);
        if (next) {
          const first = !rates;
          fiatRates = next;
          mergeRates();
          lastFailure = 0;
          // Inline mode gives up when it runs with no rates, and a first fetch
          // that finished after the page did left the page bare for good.
          if (first) annotator?.refresh();
        }
      }
      if (changes[STORAGE.RATES_TS]) {
        const ts = changes[STORAGE.RATES_TS].newValue;
        if (typeof ts === 'number') ratesTimestamp = ts;
      }
      if (changes[STORAGE.CRYPTO_RATES]) {
        // Undefined here is a removal, which is what revoking the permission
        // does. Badges priced against a table we no longer hold come off.
        cryptoRates = parseCryptoTable(changes[STORAGE.CRYPTO_RATES].newValue);
        mergeRates();
        lastCryptoFailure = 0;
        annotator?.refresh();
      }
      if (changes[STORAGE.CRYPTO_TS]) {
        const ts = changes[STORAGE.CRYPTO_TS].newValue;
        cryptoTimestamp = typeof ts === 'number' ? ts : 0;
      }
    };
    chrome.storage.onChanged.addListener(onRatesChanged);

    if (isActiveOn(settings, hostname)) startListening();

    // 'pagehide' rather than the deprecated 'unload'. `persisted` means the page
    // is going into the back/forward cache with this script still loaded, so
    // tearing down would kill the tooltip for the rest of that page's life.
    window.addEventListener('pagehide', (event) => {
      if (event.persisted) { clearHover(); hide(); return; }
      stopListening();
      unwatch();
      chrome.storage.onChanged.removeListener(onRatesChanged);
    });
  },
});
