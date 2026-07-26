import { CURRENCY_BY_CODE } from './currencies';
import { STORAGE, DEFAULT_CURRENCIES } from './types';

/**
 * How converted amounts are rounded before display.
 *
 * `exact`:   whatever the currency's minor unit calls for ($39.36, ¥1235).
 * `smart`:   fewer digits as the amount grows, prefixed with `≈` whenever the
 *            rounding actually moved the number. A conversion is an estimate;
 *            two decimals on a 4-digit amount pretend otherwise.
 * `integer`: never any decimals.
 */
export type Rounding = 'exact' | 'smart' | 'integer';

export interface Settings {
  /** Master switch. Off means the content script does nothing at all. */
  enabled: boolean;
  /** Hostnames where the extension stays quiet. Stored without `www.`. */
  disabledSites: string[];
  /** The user's own currency. Always shown first, never converted away from. */
  baseCurrency: string;
  /** Additional currencies to show. Never contains `baseCurrency`. */
  targetCurrencies: string[];
  /** Hover intent, in ms. 0 shows the tooltip immediately. */
  hoverDelayMs: number;
  rounding: Rounding;
  /** Rewrite prices in the page instead of waiting for a hover. */
  inlineMode: boolean;
  /** Resolve `$`, `kr` and `¥` using the page's domain and language. */
  usePageContext: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  disabledSites: [],
  baseCurrency: 'EUR',
  targetCurrencies: ['USD', 'GBP'],
  hoverDelayMs: 180,
  rounding: 'smart',
  inlineMode: false,
  usePageContext: true,
};

export const HOVER_DELAY_CHOICES = [0, 120, 180, 300, 500] as const;

/** `www.` is noise: a user disabling `www.amazon.fr` means `amazon.fr`. */
export function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

export function isSiteDisabled(settings: Settings, hostname: string): boolean {
  return settings.disabledSites.includes(normalizeHostname(hostname));
}

export function isActiveOn(settings: Settings, hostname: string): boolean {
  return settings.enabled && !isSiteDisabled(settings, hostname);
}

/** Every currency the user wants to see, base first. */
export function displayCurrencies(settings: Settings): string[] {
  return [settings.baseCurrency, ...settings.targetCurrencies];
}

function validCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && CURRENCY_BY_CODE.has(value) ? value : fallback;
}

function validCodeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === 'string' && CURRENCY_BY_CODE.has(item)) seen.add(item);
  }
  return [...seen];
}

/**
 * Accepts anything and returns something usable. Storage is written by older
 * builds of this extension and, in the popup's case, by a user editing it in
 * devtools. Neither is a reason to end up with `undefined.length`.
 */
export function parseSettings(raw: unknown): Settings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const baseCurrency = validCode(input.baseCurrency, DEFAULT_SETTINGS.baseCurrency);
  // An empty array means the user removed every target; a missing key means we
  // are looking at something that is not a settings object at all.
  const targets = (Array.isArray(input.targetCurrencies)
    ? validCodeList(input.targetCurrencies)
    : DEFAULT_SETTINGS.targetCurrencies
  ).filter((c) => c !== baseCurrency);

  const delay = Number(input.hoverDelayMs);
  const rounding = input.rounding;

  return {
    enabled: input.enabled !== false,
    disabledSites: Array.isArray(input.disabledSites)
      ? [...new Set(input.disabledSites.filter((s): s is string => typeof s === 'string').map(normalizeHostname))]
      : [],
    baseCurrency,
    targetCurrencies: targets,
    hoverDelayMs: Number.isFinite(delay) ? Math.min(2000, Math.max(0, delay)) : DEFAULT_SETTINGS.hoverDelayMs,
    rounding:
      rounding === 'exact' || rounding === 'smart' || rounding === 'integer'
        ? rounding
        : DEFAULT_SETTINGS.rounding,
    inlineMode: input.inlineMode === true,
    usePageContext: input.usePageContext !== false,
  };
}

/**
 * Before 1.4.0 the only setting was a flat list of currencies under
 * `selectedCurrencies`, with no notion of a base. The first entry becomes the
 * base, which matches how the list was ordered in the old popup.
 */
export function migrateLegacy(legacy: unknown): Settings | null {
  const codes = validCodeList(legacy);
  if (!codes.length) return null;

  const [baseCurrency, ...targetCurrencies] = codes;
  return { ...DEFAULT_SETTINGS, baseCurrency, targetCurrencies };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.local.get([STORAGE.SETTINGS, STORAGE.CURRENCIES]);
    if (stored?.[STORAGE.SETTINGS]) return parseSettings(stored[STORAGE.SETTINGS]);

    const migrated = migrateLegacy(stored?.[STORAGE.CURRENCIES]);
    if (migrated) {
      await saveSettings(migrated).catch(() => {});
      return migrated;
    }
  } catch {
    // Storage can be stubbed (some extension wrappers) and defaults still work.
  }
  return { ...DEFAULT_SETTINGS, targetCurrencies: DEFAULT_CURRENCIES.filter((c) => c !== DEFAULT_SETTINGS.baseCurrency) };
}

/**
 * Svelte 5 wraps `$state` arrays in a Proxy, and `chrome.storage` serialises a
 * proxied array as a plain **object**, `{"0":"JPY","1":"USD"}`. Reading it back
 * then fails `Array.isArray`, so the target list silently reverted to the
 * defaults and every paused site disappeared on the next page load. Spreading
 * produces a real array and costs nothing.
 */
function toPlain(settings: Settings): Settings {
  return {
    ...settings,
    targetCurrencies: [...settings.targetCurrencies],
    disabledSites: [...settings.disabledSites],
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE.SETTINGS]: toPlain(settings) });
}

/** Calls back on every change to the settings key, already parsed. */
export function watchSettings(onChange: (settings: Settings) => void): () => void {
  const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[STORAGE.SETTINGS]) onChange(parseSettings(changes[STORAGE.SETTINGS].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
