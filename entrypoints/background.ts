import { MESSAGE } from '../src/messages';
import type { RefreshResult } from '../src/messages';
import { fetchRates } from '../src/rates';
import { loadSettings, parseSettings } from '../src/settings';
import { CACHE_DURATION_MS, STORAGE } from '../src/types';

/**
 * One request at a time. The popup, the options page and every content script
 * on every open tab all ask through here, and a page of prices used to turn
 * into one request per hover the moment the rates were stale.
 */
let inFlight: Promise<RefreshResult> | null = null;

function refreshRates(): Promise<RefreshResult> {
  inFlight ??= (async (): Promise<RefreshResult> => {
    try {
      const rates = await fetchRates();
      if (!rates) throw new Error('Invalid response: missing or unusable rates');

      const timestamp = Date.now();
      await chrome.storage.local.set({
        [STORAGE.RATES]: rates,
        [STORAGE.RATES_TS]: timestamp,
      });
      return { ok: true, timestamp };
    } catch (err) {
      console.error('[PriceHover] Failed to refresh rates:', err);
      return { ok: false };
    }
  })().finally(() => { inFlight = null; });

  return inFlight;
}

async function refreshIfStale(): Promise<void> {
  const stored = await chrome.storage.local.get([STORAGE.RATES_TS]);
  const ts = (stored as Record<string, unknown>)[STORAGE.RATES_TS];
  const lastRefresh = typeof ts === 'number' ? ts : 0;

  // Absolute: a clock set back leaves a timestamp in the future, and signed
  // arithmetic read that as infinitely fresh, so the rates never refreshed
  // again for as long as the skew lasted.
  if (Math.abs(Date.now() - lastRefresh) > CACHE_DURATION_MS) await refreshRates();
}

async function setBadge(enabled: boolean): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text: enabled ? '' : 'off' });
    await chrome.action.setBadgeBackgroundColor({ color: '#8a8a8a' });
  } catch {
    // `action` is missing in some extension wrappers; the badge is cosmetic.
  }
}

/**
 * The only sign of the master switch when the popup is closed. Per-site pausing
 * is deliberately absent from the badge: naming the active tab outside a click
 * on the icon would cost a `tabs` permission, and `activeTab` grants nothing at
 * rest, which is the whole reason it shows no install warning.
 */
async function syncBadge(): Promise<void> {
  const settings = await loadSettings().catch(() => null);
  await setBadge(settings?.enabled !== false);
}

export default defineBackground(() => {
  chrome.runtime.onInstalled?.addListener((details) => {
    refreshIfStale().catch(() => {});
    syncBadge().catch(() => {});

    // A fresh install lands on the options page. Without it the extension gives
    // no sign it exists beyond an icon, and everything it does depends on the
    // user having said which currency is theirs.
    if (details.reason === 'install') {
      // `openOptionsPage` takes no URL, and the welcome banner needs the hash to
      // know it is a first run rather than a normal visit.
      try {
        chrome.tabs.create({ url: chrome.runtime.getURL('options.html#welcome') });
      } catch {
        try { chrome.runtime.openOptionsPage(); } catch { /* not available everywhere */ }
      }
    }
  });

  chrome.runtime.onStartup?.addListener(() => {
    refreshIfStale().catch(() => {});
    syncBadge().catch(() => {});
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE.SETTINGS]) return;
    setBadge(parseSettings(changes[STORAGE.SETTINGS].newValue).enabled).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = (message as { type?: string })?.type;

    if (type === MESSAGE.OPEN_OPTIONS) {
      try { chrome.runtime.openOptionsPage(); } catch { /* ignore */ }
      sendResponse({ ok: true });
      return false;
    }

    if (type === MESSAGE.REFRESH_RATES) {
      refreshRates().then(sendResponse);
      return true; // keeps the channel open for the async reply
    }

    return false;
  });

  // Initial pass for environments that fire neither onInstalled nor onStartup.
  refreshIfStale().catch(() => {});
  syncBadge().catch(() => {});

  // Only fires where the background page is persistent (Firefox, wrappers like
  // Extendium). An MV3 service worker is torn down long before 24 h elapse, so
  // Chrome relies on the hooks above plus the content script, which asks for a
  // refresh through `REFRESH_RATES` as soon as it finds the cache stale.
  // chrome.alarms would survive the teardown but costs an extra permission we
  // deliberately do not ask for.
  setInterval(() => { refreshRates().catch(() => {}); }, CACHE_DURATION_MS);
});
