import { mount, unmount } from 'svelte';
import { detectPrice, detectPriceFromText } from '../src/detector';
import { CURRENCY_BY_CODE } from '../src/currencies';
import { STORAGE, DEFAULT_CURRENCIES } from '../src/types';
import type { ConvertedPrice, DetectedPrice, ExchangeRates } from '../src/types';
import Tooltip from '../src/tooltip.svelte';
import tooltipStyles from '../src/tooltip.css?inline';

const L = (msg: string, ...args: unknown[]) => console.log(`[PH] ${msg}`, ...args);
const E = (msg: string, err: unknown) => console.error(`[PH] ${msg}`, err);

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  main() {
    L('content script start');

    if (!document.body) { L('no document.body, aborting'); return; }

    // Shadow DOM host
    const host = document.createElement('div');
    host.id = 'pricehover-root';
    host.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    document.body.appendChild(host);
    L('shadow DOM created');

    const style = document.createElement('style');
    style.textContent = tooltipStyles;
    shadow.appendChild(style);

    const container = document.createElement('div');
    shadow.appendChild(container);

    let tooltipInstance: ReturnType<typeof mount> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    let cachedRates: ExchangeRates | null = null;
    let cachedCurrencies: string[] = DEFAULT_CURRENCIES;
    let cacheLoadedAt = 0;
    const CACHE_TTL = 10_000;

    async function refreshCache(): Promise<void> {
      L('refreshCache start');
      try {
        const ratesResponse = await chrome.runtime.sendMessage({ type: 'getRates' });
        L('getRates response:', ratesResponse);
        if (ratesResponse?.rates) {
          cachedRates = ratesResponse.rates;
          L('rates loaded, keys sample:', Object.keys(cachedRates!).slice(0, 5));
        } else {
          L('getRates response had no rates');
        }
      } catch (err) {
        E('sendMessage getRates failed', err);
      }

      // storage.sync requires a permanent addon ID in Firefox — fall back to local
      try {
        const store = await chrome.storage.sync.get([STORAGE.CURRENCIES])
          .catch(() => chrome.storage.local.get([STORAGE.CURRENCIES]));
        L('currencies storage:', store);
        if (store[STORAGE.CURRENCIES]) cachedCurrencies = store[STORAGE.CURRENCIES];
      } catch (err) {
        E('storage currencies get failed', err);
      }

      cacheLoadedAt = Date.now();
      L('refreshCache done — cachedRates null?', cachedRates === null, 'currencies:', cachedCurrencies);
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
      if (!sourceRate) { L('no source rate for', detected.currencyCode); return []; }

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

    async function showTooltip(detected: DetectedPrice, x: number, y: number): Promise<void> {
      L('showTooltip', detected, 'cacheAge:', Date.now() - cacheLoadedAt);
      if (Date.now() - cacheLoadedAt > CACHE_TTL) await refreshCache();
      if (!cachedRates) { L('cachedRates still null, aborting tooltip'); return; }

      const conversions = convertPrice(detected, cachedRates, cachedCurrencies);
      L('conversions:', conversions.length);
      hideTooltip();

      tooltipInstance = mount(Tooltip, {
        target: container,
        props: { source: detected, conversions, x, y },
      });
      L('tooltip mounted');
    }

    function onMouseOver(e: MouseEvent): void {
      if (debounceTimer) clearTimeout(debounceTimer);

      debounceTimer = setTimeout(() => {
        const target = e.target as Element | null;
        if (!target || target === host) return;

        try {
          const detected = detectPrice(target);
          if (!detected) { hideTooltip(); return; }

          L('detected price:', detected, 'on element:', target.tagName, target.textContent?.trim().slice(0, 30));
          const rect = target.getBoundingClientRect();
          showTooltip(detected, rect.left + rect.width / 2, rect.top);
        } catch (err) {
          E('onMouseOver error', err);
          hideTooltip();
        }
      }, 80);
    }

    function onMouseOut(): void {
      if (debounceTimer) clearTimeout(debounceTimer);
      hideTooltip();
    }

    function onSelectionChange(): void {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) { hideTooltip(); return; }

      const text = selection.toString().trim();
      if (!text) { hideTooltip(); return; }

      const detected = detectPriceFromText(text);
      if (!detected) { hideTooltip(); return; }

      L('detected from selection:', detected);
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showTooltip(detected, rect.left + rect.width / 2, rect.top);
    }

    document.addEventListener('mouseover', onMouseOver, { passive: true });
    document.addEventListener('mouseout', onMouseOut, { passive: true });
    document.addEventListener('selectionchange', onSelectionChange, { passive: true });
    L('event listeners registered');

    window.addEventListener('unload', () => {
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('selectionchange', onSelectionChange);
      hideTooltip();
      host.remove();
    });
  },
});
