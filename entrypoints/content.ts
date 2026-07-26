import { mount, unmount } from 'svelte';
import { convertPrice } from '../src/convert';
import { detectPricesFromElement, detectPriceFromText } from '../src/detector';
import { createInlineAnnotator, INLINE_ATTR } from '../src/inline';
import { makeTokenResolver } from '../src/locale';
import type { TokenResolver } from '../src/locale';
import { fetchRates, parseRates } from '../src/rates';
import { isActiveOn, loadSettings, watchSettings } from '../src/settings';
import type { Settings } from '../src/settings';
import Tooltip from '../src/tooltip.svelte';
import { getCardRect, hideTooltipState, moveTooltipState, showTooltipState } from '../src/tooltip-state';
import tooltipStyles from '../src/tooltip.css?inline';
import { CACHE_DURATION_MS, STALE_AFTER_MS, STORAGE } from '../src/types';
import type { DetectedPrice, ExchangeRates } from '../src/types';

const E = (msg: string, err: unknown) => console.error(`[PH] ${msg}`, err);

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  async main() {
    if (!document.body) return;

    const hostname = location.hostname;
    let settings = await loadSettings();

    // ── Rates ────────────────────────────────────────────────────────────────
    // Fetched on first need, not on page load. Most pages are never hovered,
    // and a storage read per page for rates nobody asked for is a page-load
    // cost paid on every site the user visits.

    let rates: ExchangeRates | null = null;
    let ratesTimestamp = 0;
    let ratesPromise: Promise<void> | null = null;

    async function fetchDirect(): Promise<void> {
      try {
        const fetched = await fetchRates();
        if (!fetched) return;
        rates = fetched;
        ratesTimestamp = Date.now();
        try {
          await chrome.storage.local.set({
            [STORAGE.RATES]: fetched,
            [STORAGE.RATES_TS]: ratesTimestamp,
          });
        } catch { /* storage may be stubbed by an extension wrapper */ }
      } catch (err) {
        E('direct rate fetch failed', err);
      }
    }

    function ensureRates(): Promise<void> {
      if (!ratesPromise) {
        ratesPromise = (async () => {
          try {
            const stored = await chrome.storage.local.get([STORAGE.RATES, STORAGE.RATES_TS]);
            const parsed = parseRates(stored?.[STORAGE.RATES]);
            if (parsed) {
              rates = parsed;
              const ts = stored?.[STORAGE.RATES_TS];
              ratesTimestamp = typeof ts === 'number' ? ts : 0;
            }
            if (!rates || Date.now() - ratesTimestamp > CACHE_DURATION_MS) await fetchDirect();
          } catch {
            if (!rates) await fetchDirect();
          }
        })().finally(() => { ratesPromise = null; });
      }
      return ratesPromise;
    }

    const ratesAreStale = (): boolean => Date.now() - ratesTimestamp > STALE_AFTER_MS;

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
      if (host) return host;

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
    const detectionCache = new WeakMap<Element, CachedDetection>();

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
      if (!rates) {
        pending = { price, rect };
        ensureRates().then(() => {
          const queued = pending;
          pending = null;
          if (queued && rates) show(queued.price, queued.rect);
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
        stale: ratesAreStale(),
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

      if (hoverTimer !== null) clearTimeout(hoverTimer);
      if (activeElement) clearHover();

      const { clientX: x, clientY: y } = e;
      lastPointer = { x, y };

      // Hover intent. Everything expensive — textContent, the regex, building
      // ranges — happens here and nowhere else, so sweeping the pointer across
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
      if (related && withinCard(lastPointer.x, lastPointer.y)) return;

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

      const active = isActiveOn(settings, hostname);
      if (!active) { stopListening(); return; }

      if (!wasActive) { startListening(); return; }

      // A changed resolver or currency list invalidates every cached detection.
      clearHover();
      hide();
      syncInlineMode();
    }

    const unwatch = watchSettings(applySettings);

    const onRatesChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area !== 'local') return;
      if (changes[STORAGE.RATES]) {
        const next = parseRates(changes[STORAGE.RATES].newValue);
        if (next) rates = next;
      }
      if (changes[STORAGE.RATES_TS]) {
        const ts = changes[STORAGE.RATES_TS].newValue;
        if (typeof ts === 'number') ratesTimestamp = ts;
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
