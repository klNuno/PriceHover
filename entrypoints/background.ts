import { CACHE_DURATION_MS, STORAGE } from '../src/types';

const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const ALARM_NAME = 'refreshRates';

async function refreshRates(): Promise<void> {
  try {
    const res = await fetch(RATES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (!data.rates) throw new Error('Invalid response: missing rates');

    await chrome.storage.local.set({
      [STORAGE.RATES]: data.rates,
      [STORAGE.RATES_TS]: Date.now(),
    });

    console.log('[PriceHover] Rates updated successfully');
  } catch (err) {
    console.error('[PriceHover] Failed to refresh rates:', err);
  }
}

async function refreshIfStale(): Promise<void> {
  const stored = await chrome.storage.local.get([STORAGE.RATES_TS]);
  const ts: number = stored[STORAGE.RATES_TS] ?? 0;

  if (Date.now() - ts > CACHE_DURATION_MS) {
    await refreshRates();
  }
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(async () => {
    await refreshRates();
  });

  chrome.runtime.onStartup.addListener(async () => {
    await refreshIfStale();
  });

  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1440 });

  chrome.alarms.onAlarm.addListener(({ name }) => {
    if (name === ALARM_NAME) refreshRates().catch(() => {});
  });

});
