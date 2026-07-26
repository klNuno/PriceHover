import { CACHE_DURATION_MS, STORAGE } from '../src/types';
import { fetchRates } from '../src/rates';

async function refreshRates(): Promise<void> {
  try {
    const rates = await fetchRates();
    if (!rates) throw new Error('Invalid response: missing or unusable rates');

    await chrome.storage.local.set({
      [STORAGE.RATES]: rates,
      [STORAGE.RATES_TS]: Date.now(),
    });
  } catch (err) {
    console.error('[PriceHover] Failed to refresh rates:', err);
  }
}

async function refreshIfStale(): Promise<void> {
  const stored = await chrome.storage.local.get([STORAGE.RATES_TS]);
  const ts = (stored as Record<string, unknown>)[STORAGE.RATES_TS];
  const lastRefresh = typeof ts === 'number' ? ts : 0;

  if (Date.now() - lastRefresh > CACHE_DURATION_MS) {
    await refreshRates();
  }
}

export default defineBackground(() => {
  chrome.runtime.onInstalled?.addListener(() => { refreshIfStale().catch(() => {}); });
  chrome.runtime.onStartup?.addListener(() => { refreshIfStale().catch(() => {}); });

  // Initial fetch for environments that don't fire onInstalled/onStartup.
  refreshIfStale().catch(() => {});

  // Only fires where the background page is persistent (Firefox, wrappers like
  // Extendium). An MV3 service worker is torn down long before 24 h elapse, so
  // Chrome relies on the checks above plus the content script, which refreshes
  // stale rates itself. chrome.alarms would survive the teardown but costs an
  // extra permission we deliberately do not ask for.
  setInterval(() => { refreshRates().catch(() => {}); }, CACHE_DURATION_MS);
});
