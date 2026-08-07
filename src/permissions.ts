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
 * Chrome hands a declared content script its origins at install and never asks
 * again. Firefox treats them as a permission, remembers the answer per
 * extension id, and keeps that answer across reinstalls: an extension once set
 * to "only when clicked" stays that way through every new build, running on one
 * tab at a time and looking broken everywhere else. Declaring `<all_urls>` in
 * the manifest is what makes it *requestable*; this is what asks.
 */
const PAGE_PERMISSION: chrome.permissions.Permissions = { origins: ['<all_urls>'] };

/**
 * Whether the extension may run on pages without being clicked first. Always
 * true where the question does not arise, so no caller has to know which
 * browser it is on.
 */
export async function hasPageAccess(): Promise<boolean> {
  if (!import.meta.env.FIREFOX) return true;
  try {
    return await chrome.permissions.contains(PAGE_PERMISSION);
  } catch {
    return true;
  }
}

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
