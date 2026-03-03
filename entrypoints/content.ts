import { mount, unmount } from 'svelte';
import { detectPricesFromElement, detectPriceFromText } from '../src/detector';
import { CURRENCY_BY_CODE } from '../src/currencies';
import { STORAGE, DEFAULT_CURRENCIES } from '../src/types';
import type { ConvertedPrice, DetectedPrice, ExchangeRates } from '../src/types';
import Tooltip from '../src/tooltip.svelte';
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

    let tooltipInstance: ReturnType<typeof mount> | null = null;
    let rafId: number | null = null;

    let cachedRates: ExchangeRates | null = null;
    let cachedCurrencies: string[] = DEFAULT_CURRENCIES;
    let cacheLoadedAt = 0;
    const CACHE_TTL = 10_000;

    async function refreshCache(): Promise<void> {
      try {
        const ratesResponse = await chrome.runtime.sendMessage({ type: 'getRates' });
        if (ratesResponse?.rates) cachedRates = ratesResponse.rates;
      } catch (err) {
        E('sendMessage getRates failed', err);
      }

      try {
        await new Promise<void>((resolve) => {
          chrome.storage.local.get([STORAGE.CURRENCIES], (r) => {
            if (r?.[STORAGE.CURRENCIES]) cachedCurrencies = r[STORAGE.CURRENCIES] as string[];
            resolve();
          });
        });
      } catch (err) {
        E('storage currencies get failed', err);
      }

      cacheLoadedAt = Date.now();
    }

    refreshCache();

    function hideTooltip(): void {
      if (tooltipInstance) {
        unmount(tooltipInstance);
        tooltipInstance = null;
      }
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

          let formatted: string;
          try {
            formatted = new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: code,
              maximumFractionDigits: code === 'JPY' || code === 'KRW' ? 0 : 2,
            }).format(amount);
          } catch {
            formatted = `${amount.toFixed(2)} ${code}`;
          }

          return { currency, amount, formatted } satisfies ConvertedPrice;
        })
        .filter((c): c is ConvertedPrice => c !== null);
    }

    async function showTooltip(prices: DetectedPrice[], x: number, y: number): Promise<void> {
      if (Date.now() - cacheLoadedAt > CACHE_TTL) await refreshCache();
      if (!cachedRates) return;

      const allConversions = prices.map(p => convertPrice(p, cachedRates!, cachedCurrencies));
      hideTooltip();

      tooltipInstance = mount(Tooltip, {
        target: container,
        props: { sources: prices, allConversions, x, y },
      });
    }

    function findPriceRange(element: Element, matchedText: string): Range | null {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const content = node.textContent ?? '';
        const idx = content.indexOf(matchedText);
        if (idx !== -1) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + matchedText.length);
          return range;
        }
      }
      return null;
    }

    function onMouseOver(e: MouseEvent): void {
      if (rafId !== null) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        rafId = null;
        const target = e.target as Element | null;
        if (!target || target === host) return;

        try {
          const allPrices = detectPricesFromElement(target);
          // Selected currencies are ones you already understand → suppress tooltip for them
          const prices = allPrices.filter(p => !cachedCurrencies.includes(p.currencyCode));
          if (!prices.length) { hideTooltip(); return; }


          // Position tooltip above the first matched price text via Range API.
          const first = prices[0];
          if (first.matchedText) {
            const range = findPriceRange(target, first.matchedText);
            if (range) {
              const rect = range.getBoundingClientRect();
              if (rect.width > 0) {
                showTooltip(prices, rect.left + rect.width / 2, rect.top);
                return;
              }
            }
          }

          // Fallback: semantic detection or Range not found.
          const rect = target.getBoundingClientRect();
          showTooltip(prices, rect.left + rect.width / 2, rect.top);
        } catch (err) {
          E('onMouseOver error', err);
          hideTooltip();
        }
      });
    }

    function onMouseOut(): void {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      hideTooltip();
    }

    function onSelectionChange(): void {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) { hideTooltip(); return; }

      const text = selection.toString().trim();
      if (!text) { hideTooltip(); return; }

      const detected = detectPriceFromText(text);
      if (!detected || cachedCurrencies.includes(detected.currencyCode)) { hideTooltip(); return; }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showTooltip([detected], rect.left + rect.width / 2, rect.top);
    }

    document.addEventListener('mouseover', onMouseOver, { passive: true });
    document.addEventListener('mouseout', onMouseOut, { passive: true });
    document.addEventListener('selectionchange', onSelectionChange, { passive: true });

    window.addEventListener('unload', () => {
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('selectionchange', onSelectionChange);
      hideTooltip();
      host.remove();
    });
  },
});
