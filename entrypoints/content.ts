import { mount, unmount } from 'svelte';
import { detectPricesFromElement, detectPriceFromText } from '../src/detector';
import { CURRENCY_BY_CODE } from '../src/currencies';
import { STORAGE, DEFAULT_CURRENCIES } from '../src/types';
import type { ConvertedPrice, DetectedPrice, ExchangeRates } from '../src/types';
import { formatCurrencyAmount } from '../src/formatter';
import Tooltip from '../src/tooltip.svelte';
import { hideTooltipState, showTooltipState } from '../src/tooltip-state';
import tooltipStyles from '../src/tooltip.css?inline';

const E = (msg: string, err: unknown) => console.error(`[PH] ${msg}`, err);

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  main() {
    if (!document.body) return;

    // Shadow DOM host
    const host = document.createElement('div');
    host.id = 'pricehover-root';
    host.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    document.body.appendChild(host);

    const style = document.createElement('style');
    style.textContent = tooltipStyles;
    shadow.appendChild(style);

    const container = document.createElement('div');
    shadow.appendChild(container);

    const tooltipInstance = mount(Tooltip, { target: container });
    let rafId: number | null = null;
    let selRafId: number | null = null;

    let cachedRates: ExchangeRates | null = null;
    let cachedCurrencies: string[] = DEFAULT_CURRENCIES;
    let cachedCurrencySet = new Set(DEFAULT_CURRENCIES);
    let refreshPromise: Promise<void> | null = null;
    const detectionCache = new WeakMap<Element, DetectedPrice[] | null>();

    function setCachedCurrencies(next: string[] | undefined): void {
      cachedCurrencies = next?.length ? next : DEFAULT_CURRENCIES;
      cachedCurrencySet = new Set(cachedCurrencies);
    }

    function refreshCache(): Promise<void> {
      if (!refreshPromise) {
        refreshPromise = (async () => {
          try {
            const r = await chrome.storage.local.get([STORAGE.RATES, STORAGE.CURRENCIES]);
            if (r?.[STORAGE.RATES]) cachedRates = r[STORAGE.RATES] as ExchangeRates;
            if (r?.[STORAGE.CURRENCIES]) setCachedCurrencies(r[STORAGE.CURRENCIES] as string[]);
          } catch (err) {
            E('storage get failed', err);
          }
        })().finally(() => { refreshPromise = null; });
      }
      return refreshPromise;
    }

    refreshCache();

    function hideTooltip(): void {
      hideTooltipState();
    }

    function convertPrice(
      detected: DetectedPrice,
      rates: ExchangeRates,
      targetCodes: string[]
    ): ConvertedPrice[] {
      const sourceRate = rates[detected.currencyCode];
      if (!sourceRate) return [];

      return targetCodes
        .filter((code) => code !== detected.currencyCode)
        .map((code) => {
          const targetRate = rates[code];
          if (!targetRate) return null;

          const amount = detected.amount * (targetRate / sourceRate);
          const currency = CURRENCY_BY_CODE.get(code);
          if (!currency) return null;

          const formatted = formatCurrencyAmount(amount, code);
          return { currency, amount, formatted } satisfies ConvertedPrice;
        })
        .filter((c): c is ConvertedPrice => c !== null);
    }

    function showTooltip(prices: DetectedPrice[], x: number, y: number, yBottom: number): void {
      if (!cachedRates) {
        refreshCache();
        return;
      }

      const allConversions = prices.map((p) => convertPrice(p, cachedRates!, cachedCurrencies));
      showTooltipState({ sources: prices, allConversions, x, y, yBottom });
    }

    function detectPricesWithCache(element: Element): DetectedPrice[] {
      if (detectionCache.has(element)) {
        return detectionCache.get(element) ?? [];
      }

      const detected = detectPricesFromElement(element);
      detectionCache.set(element, detected.length ? detected : null);
      return detected;
    }

    // ── Multi-price hover state ──────────────────────────────────────────────

    interface PriceHitbox {
      price: DetectedPrice;
      rects: DOMRect[];  // getClientRects() — one rect per line when text wraps
    }

    interface TextSegment {
      node: Text;
      start: number;
      end: number;
    }

    const MIN_HITBOX_WIDTH = 6;
    const MIN_HITBOX_HEIGHT = 6;

    let activeElement: Element | null = null;
    let priceHitboxes: PriceHitbox[] = [];
    let activePriceIdx = -1;
    let mmRafId: number | null = null;

    function collectTextSegments(element: Element, directOnly: boolean): TextSegment[] {
      const segments: TextSegment[] = [];
      let offset = 0;

      const pushTextNode = (node: Node): void => {
        const content = node.textContent ?? '';
        if (!content.length) return;
        segments.push({ node: node as Text, start: offset, end: offset + content.length });
        offset += content.length;
      };

      if (directOnly) {
        for (const node of element.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) pushTextNode(node);
        }
        return segments;
      }

      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        pushTextNode(node);
      }
      return segments;
    }

    function buildHitboxes(element: Element, prices: DetectedPrice[]): PriceHitbox[] {
      const positionalPrices = prices.filter(
        (price): price is DetectedPrice & { matchStart: number; matchEnd: number; textSource: 'full' | 'direct' } =>
          typeof price.matchStart === 'number' &&
          typeof price.matchEnd === 'number' &&
          (price.textSource === 'full' || price.textSource === 'direct')
      );

      if (!positionalPrices.length) return [];

      const segments = collectTextSegments(element, positionalPrices[0].textSource === 'direct');
      if (!segments.length) return [];

      const result: PriceHitbox[] = [];
      let segmentIndex = 0;

      for (const price of positionalPrices) {
        while (segmentIndex < segments.length && segments[segmentIndex].end <= price.matchStart) {
          segmentIndex++;
        }

        if (segmentIndex >= segments.length) break;

        const startSegment = segments[segmentIndex];
        if (price.matchStart < startSegment.start || price.matchStart > startSegment.end) continue;

        let endSegmentIndex = segmentIndex;
        while (endSegmentIndex < segments.length && segments[endSegmentIndex].end < price.matchEnd) {
          endSegmentIndex++;
        }

        if (endSegmentIndex >= segments.length) break;

        const endSegment = segments[endSegmentIndex];
        if (price.matchEnd < endSegment.start || price.matchEnd > endSegment.end) continue;

        const range = document.createRange();
        range.setStart(startSegment.node, price.matchStart - startSegment.start);
        range.setEnd(endSegment.node, price.matchEnd - endSegment.start);

        const rects = [...range.getClientRects()].filter(
          (rect) => rect.width >= MIN_HITBOX_WIDTH && rect.height >= MIN_HITBOX_HEIGHT
        );
        if (rects.length) result.push({ price, rects });
        segmentIndex = endSegmentIndex;
      }
      return result;
    }

    function hitTest(x: number, y: number): number {
      for (let i = 0; i < priceHitboxes.length; i++) {
        for (const rect of priceHitboxes[i].rects) {
          // Small vertical padding (4px) for easier targeting on single-line text
          if (x >= rect.left && x <= rect.right && y >= rect.top - 4 && y <= rect.bottom + 4) {
            return i;
          }
        }
      }
      return -1;
    }

    function onMouseMove(e: MouseEvent): void {
      if (mmRafId !== null) return;
      mmRafId = requestAnimationFrame(() => {
        mmRafId = null;
        const idx = hitTest(e.clientX, e.clientY);
        if (idx === activePriceIdx) return;
        activePriceIdx = idx;
        if (idx === -1) {
          hideTooltip();
        } else {
          const { price, rects } = priceHitboxes[idx];
          const r = rects[0];
          showTooltip([price], r.left + r.width / 2, r.top, r.bottom);
        }
      });
    }

    function clearMultiHover(): void {
      if (mmRafId !== null) { cancelAnimationFrame(mmRafId); mmRafId = null; }
      document.removeEventListener('mousemove', onMouseMove);
      activeElement = null;
      priceHitboxes = [];
      activePriceIdx = -1;
    }

    // ── Event handlers ───────────────────────────────────────────────────────

    function onMouseOver(e: MouseEvent): void {
      if (rafId !== null) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        rafId = null;
        const target = e.target as Element | null;
        if (!target || target === host) return;

        // Still inside the active multi-price element (entered a child) — let mousemove handle it
        if (activeElement && (target === activeElement || activeElement.contains(target))) return;

        // Left previous multi-price element
        if (activeElement) clearMultiHover();

        try {
          // Try target first, then parent once — handles split DOM like <span>¥</span><span>348</span>
          let priceEl: Element = target;
          let allPrices = detectPricesWithCache(target);
          if (!allPrices.length && target.parentElement && target.parentElement !== host) {
            const parentPrices = detectPricesWithCache(target.parentElement);
            if (parentPrices.length) { allPrices = parentPrices; priceEl = target.parentElement; }
          }
          const prices = allPrices.filter((p) => !cachedCurrencySet.has(p.currencyCode));
          if (!prices.length) { hideTooltip(); return; }

          // Always use hitbox approach: tooltip shows only when cursor is over price text
          activeElement = priceEl;
          priceHitboxes = buildHitboxes(priceEl, prices);
          document.addEventListener('mousemove', onMouseMove, { passive: true });

          // Show immediately if cursor is already over a price (entry position)
          const idx = hitTest(e.clientX, e.clientY);
          if (idx !== -1) {
            activePriceIdx = idx;
            const { price, rects } = priceHitboxes[idx];
            const r = rects[0];
            showTooltip([price], r.left + r.width / 2, r.top, r.bottom);
          }
        } catch (err) {
          E('onMouseOver error', err);
          hideTooltip();
        }
      });
    }

    function onMouseOut(e: MouseEvent): void {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }

      // If moving to a child of activeElement, mouseover will handle it — don't clear yet
      const related = e.relatedTarget as Element | null;
      if (activeElement && related && activeElement.contains(related)) return;

      clearMultiHover();
      hideTooltip();
    }

    function onSelectionChange(): void {
      if (selRafId !== null) cancelAnimationFrame(selRafId);
      selRafId = requestAnimationFrame(() => {
        selRafId = null;
        try {
          const selection = window.getSelection();
          if (!selection || selection.isCollapsed) { hideTooltip(); return; }

          const text = selection.toString().trim();
          if (!text) { hideTooltip(); return; }

          const detected = detectPriceFromText(text);
          if (!detected || cachedCurrencySet.has(detected.currencyCode)) { hideTooltip(); return; }

          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          showTooltip([detected], rect.left + rect.width / 2, rect.top, rect.bottom);
        } catch (err) {
          E('onSelectionChange error', err);
          hideTooltip();
        }
      });
    }

    function onViewportChange(): void {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      clearMultiHover();
      hideTooltip();
    }

    document.addEventListener('mouseover', onMouseOver, { passive: true });
    document.addEventListener('mouseout', onMouseOut, { passive: true });
    document.addEventListener('selectionchange', onSelectionChange, { passive: true });
    document.addEventListener('scroll', onViewportChange, { passive: true, capture: true });
    window.addEventListener('resize', onViewportChange, { passive: true });

    const onStorageChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes[STORAGE.RATES]?.newValue) {
        cachedRates = changes[STORAGE.RATES].newValue as ExchangeRates;
      }
      if (changes[STORAGE.CURRENCIES]) {
        setCachedCurrencies(changes[STORAGE.CURRENCIES].newValue as string[] | undefined);
      }
    };

    chrome.storage.onChanged.addListener(onStorageChanged);

    window.addEventListener('unload', () => {
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
      chrome.storage.onChanged.removeListener(onStorageChanged);
      if (selRafId !== null) { cancelAnimationFrame(selRafId); selRafId = null; }
      clearMultiHover();
      hideTooltip();
      unmount(tooltipInstance);
      host.remove();
    });
  },
});
