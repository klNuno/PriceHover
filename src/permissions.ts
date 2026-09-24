import { CRYPTO_ORIGIN, CRYPTO_ORIGIN_PATTERN } from './rates';

/**
 * The crypto host is an optional permission, so the browser is the authority on
 * whether it may be contacted, not the settings key. The two are checked
 * together everywhere: a user who grants access and later revokes it from the
 * browser's own permissions UI never passes through our options page, and a
 * stored `cryptoEnabled: true` would otherwise keep promising a fetch that can
 * only fail.
 *
 * `chrome.permissions` is missing in some extension wrappers. Absent means no
 * access rather than a thrown error, which degrades to "crypto stays off".
 */
const CRYPTO_PERMISSION: chrome.permissions.Permissions = {
  origins: [CRYPTO_ORIGIN_PATTERN],
};

/**
 * The origins the content script is declared on.
 *
 * A fresh install grants them, in both browsers. A profile that once said "only
 * when clicked" does not, and it keeps saying it: the answer is stored per
 * extension id and survives every new build, Chrome withholding the origins
 * behind its site-access setting and Firefox behind its own. The extension then
 * looks like a broken install, because a content script that is never injected
 * has no way to say why. Declaring `<all_urls>` in the manifest is what makes
 * it requestable; this is what asks.
 */
const PAGE_PERMISSION: chrome.permissions.Permissions = { origins: ['<all_urls>'] };

/**
 * Whether the extension may run on pages without being clicked first. An
 * environment with no `chrome.permissions` cannot be withholding anything, so
 * absent reads as granted and no banner is shown over a working install.
 */
export async function hasPageAccess(): Promise<boolean> {
  try {
    if (await chrome.permissions.contains(PAGE_PERMISSION)) return true;
    // Chrome answers `contains` from the explicit host list alone, and the
    // content script's matches are never on it: `<all_urls>` lives in
    // `optional_host_permissions`, so a fresh install that runs everywhere
    // answered false and got the banner. `getAll` reports what is actually
    // active, content script origins included, and drops them once withheld.
    const { origins = [] } = await chrome.permissions.getAll();
    return origins.some((origin) => BROAD_ORIGINS.has(origin));
  } catch {
    return true;
  }
}

/** Patterns that mean "every page", in the spellings the browsers report. */
const BROAD_ORIGINS = new Set(['<all_urls>', '*://*/*']);

/** Same gesture rule as the crypto request below: call it straight from the click. */
export async function requestPageAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.request(PAGE_PERMISSION);
  } catch {
    return false;
  }
}

export async function hasCryptoAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.contains(CRYPTO_PERMISSION);
  } catch {
    return false;
  }
}

/**
 * Must be called from inside a user gesture, synchronously. Awaiting anything
 * first (a settings read, a storage write) spends the gesture, and Firefox then
 * rejects the request without ever showing the prompt.
 */
export async function requestCryptoAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.request(CRYPTO_PERMISSION);
  } catch {
    return false;
  }
}

export async function dropCryptoAccess(): Promise<void> {
  try {
    await chrome.permissions.remove(CRYPTO_PERMISSION);
  } catch {
    // Already gone, or an environment without the API: same end state.
  }
}

/**
 * Calls back when the crypto host's permission is taken away, from anywhere.
 *
 * Matched against the origin we asked for rather than a substring: the browser
 * reports the pattern it granted, and a lone `includes('coingecko')` would also
 * fire on a host that merely contains the word.
 */
export function watchCryptoRevoked(onRevoked: () => void): () => void {
  const listener = (permissions: chrome.permissions.Permissions): void => {
    const hit = permissions.origins?.some(
      (o) => o === CRYPTO_ORIGIN_PATTERN || o.startsWith(CRYPTO_ORIGIN)
    );
    if (hit) onRevoked();
  };

  try {
    chrome.permissions.onRemoved.addListener(listener);
  } catch {
    return () => {};
  }
  return () => {
    try {
      chrome.permissions.onRemoved.removeListener(listener);
    } catch {
      // Nothing to detach.
    }
  };
}
