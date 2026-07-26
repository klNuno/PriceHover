/**
 * `chrome.i18n` is available in every context this extension runs in, including
 * the content script, and it costs no permission. The wrapper exists so the UI
 * never crashes when a key is missing (the API returns an empty string, which
 * silently blanks a label) and so tests can run without the API at all.
 */

type Substitutions = string | string[];

export function t(key: string, substitutions?: Substitutions): string {
  try {
    const value = chrome.i18n.getMessage(key, substitutions);
    if (value) return value;
  } catch {
    // No extension runtime — tests, or a stubbed environment.
  }
  return key;
}

/** BCP-47 tag of the browser UI, used to format numbers the way the user reads them. */
export function uiLocale(): string {
  try {
    const tag = chrome.i18n.getUILanguage();
    if (tag) return tag;
  } catch {
    // fall through
  }
  return 'en';
}
