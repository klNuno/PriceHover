import { MESSAGE } from '../src/messages';
import type { RefreshResult } from '../src/messages';
import { hasCryptoAccess, watchCryptoRevoked } from '../src/permissions';
import { fetchCryptoRates, fetchRates } from '../src/rates';
import { loadSettings, parseSettings, updateSettings, wantsCrypto } from '../src/settings';
import { CACHE_DURATION_MS, CRYPTO_CACHE_MS, STORAGE } from '../src/types';

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

/**
 * The crypto host is contacted only when the user asked for the feature and the
 * browser still grants it. A profile that never opts in makes exactly as many
 * requests as it did before this feature existed, which is none.
 *
 * `onDemand` is the difference between the two callers. The hourly tick fetches
 * only for a list that shows a crypto row, so a profile with the switch on and
 * no crypto target sits idle. The content script asks on demand, and it asks
 * for a second reason the tick cannot see: a page priced *in* crypto needs the
 * source rate, whatever the target list holds.
 */
let cryptoInFlight: Promise<RefreshResult> | null = null;

function refreshCryptoRates(onDemand = false): Promise<RefreshResult> {
  cryptoInFlight ??= (async (): Promise<RefreshResult> => {
    try {
      const settings = await loadSettings();
      const asked = onDemand ? settings.cryptoEnabled : wantsCrypto(settings);
      if (!asked || !(await hasCryptoAccess())) return { ok: false, skipped: true };

      const rates = await fetchCryptoRates();
      if (!rates) throw new Error('Invalid response: missing or unusable crypto rates');

      const timestamp = Date.now();
      await chrome.storage.local.set({
        [STORAGE.CRYPTO_RATES]: rates,
        [STORAGE.CRYPTO_TS]: timestamp,
      });
      return { ok: true, timestamp };
    } catch (err) {
      console.error('[PriceHover] Failed to refresh crypto rates:', err);
      return { ok: false };
    }
  })().finally(() => { cryptoInFlight = null; });

  return cryptoInFlight;
}

/** Rates for a host we may no longer contact are not rates, they are a memory. */
async function forgetCryptoRates(): Promise<void> {
  await chrome.storage.local.remove([STORAGE.CRYPTO_RATES, STORAGE.CRYPTO_TS]).catch(() => {});
  await updateSettings({ cryptoEnabled: false }).catch(() => {});
}

async function refreshIfStale(): Promise<void> {
  const stored = await chrome.storage.local.get([STORAGE.RATES_TS, STORAGE.CRYPTO_TS]);
  const ts = (stored as Record<string, unknown>)[STORAGE.RATES_TS];
  const lastRefresh = typeof ts === 'number' ? ts : 0;

  // Absolute: a clock set back leaves a timestamp in the future, and signed
  // arithmetic read that as infinitely fresh, so the rates never refreshed
  // again for as long as the skew lasted.
  if (Math.abs(Date.now() - lastRefresh) > CACHE_DURATION_MS) await refreshRates();

  const cryptoTs = (stored as Record<string, unknown>)[STORAGE.CRYPTO_TS];
  const lastCrypto = typeof cryptoTs === 'number' ? cryptoTs : 0;
  if (Math.abs(Date.now() - lastCrypto) > CRYPTO_CACHE_MS) await refreshCryptoRates();
}

/**
 * Reloading an unpacked extension fires `onInstalled` with reason `install`
 * every single time, so the reason alone opened a greeting tab on every reload
 * during development, and reopening the same tab replayed the banner from the
 * hash. The flag the banner writes is the authority. A genuine reinstall drops
 * the profile's storage with it, so a real first run still gets its tab.
 */
async function openWelcome(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE.WELCOME_SEEN).catch(() => null);
  if (stored?.[STORAGE.WELCOME_SEEN]) return;

  // `openOptionsPage` takes no URL, and the welcome banner needs the hash to
  // know it is a first run rather than a normal visit.
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#welcome') });
  } catch {
    try { chrome.runtime.openOptionsPage(); } catch { /* not available everywhere */ }
  }
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
    if (details.reason === 'install') openWelcome().catch(() => {});
  });

  chrome.runtime.onStartup?.addListener(() => {
    refreshIfStale().catch(() => {});
    syncBadge().catch(() => {});
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE.SETTINGS]) return;
    setBadge(parseSettings(changes[STORAGE.SETTINGS].newValue).enabled).catch(() => {});
  });

  // Revocation happens outside this extension's UI as often as inside it, from
  // the browser's own permissions panel, and nothing else would ever tell us.
  watchCryptoRevoked(() => { forgetCryptoRates().catch(() => {}); });

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

    if (type === MESSAGE.REFRESH_CRYPTO) {
      // Only ever sent by a caller that already knows a crypto rate is needed.
      refreshCryptoRates(true).then(sendResponse);
      return true;
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
  // Same caveat, shorter clock. It is a no-op unless crypto is both asked for
  // and granted, so it costs a timer and nothing else on a default profile.
  setInterval(() => { refreshCryptoRates().catch(() => {}); }, CRYPTO_CACHE_MS);
});
