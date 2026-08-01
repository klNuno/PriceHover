import { isCryptoCode } from './crypto';
import { ASSET_BY_CODE, CURRENCY_BY_CODE } from './currencies';
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
  /**
   * Whether crypto rates may be fetched at all. Off by default, and false is
   * not the same as "no crypto in the list": the browser permission is the
   * authority, this flag only records that the user asked. A permission
   * revoked from the browser's own UI flips it back off.
   */
  cryptoEnabled: boolean;
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
  cryptoEnabled: false,
};

export const HOVER_DELAY_CHOICES = [0, 120, 180, 300, 500] as const;

/**
 * A fresh copy nothing else owns. `{ ...DEFAULT_SETTINGS }` is shallow, so the
 * arrays stayed shared with the module-level constant and one `.push` through a
 * Svelte `$state` proxy would have poisoned the defaults for the whole context.
 */
export function defaultSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    disabledSites: [...DEFAULT_SETTINGS.disabledSites],
    targetCurrencies: [...DEFAULT_SETTINGS.targetCurrencies],
  };
}

/**
 * A hostname, minus everything that cannot take part in the comparison against
 * `location.hostname`: scheme, credentials, port, path, `www.`, case, spaces.
 * `HTTPS://WWW.Amazon.ca:443/dp/x` and `amazon.ca` are the same site.
 *
 * Total by contract: it is called from `parseSettings`, which accepts anything.
 */
export function normalizeHostname(hostname: string): string {
  return String(hostname)
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^/@]*@/, '')
    .split(/[/?#]/)[0]
    .replace(/:\d*$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

/**
 * Non-empty labels separated by dots, or a bracketed IPv6 literal. Deliberately
 * permissive: intranet hosts have no TLD, `my_host.local` has an underscore and
 * a hand-typed IDN is not ASCII. It only rejects what `location.hostname` can
 * never produce, which after `normalizeHostname` means whitespace and leftover
 * URL punctuation.
 */
const HOSTNAME_RE = /^(?:\[[0-9a-f:]+\]|[^\s.:/?#@]+(?:\.[^\s.:/?#@]+)*)$/u;

/**
 * What the user typed, as a site identity, or `null` when it cannot be one.
 * Silently keeping `my site` or `example.com:8080` in the paused list looked
 * like it worked and then never matched a single page.
 *
 * Input path only. Stored entries go through `normalizeHostname` alone: this is
 * strict enough to reject an entry the user is about to add, and far too strict
 * to delete one they added years ago.
 */
export function parseHostnameInput(raw: string): string | null {
  const host = normalizeHostname(raw);
  return host && HOSTNAME_RE.test(host) ? host : null;
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

/**
 * The base currency stays fiat. Everything is converted *from* the page and
 * *to* this one, it is the row the tooltip emphasises, and it is what an
 * inferred price falls back to: a base that only exists while an optional
 * permission is granted would leave every one of those paths undefined the
 * moment the user revokes it.
 */
function validCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && CURRENCY_BY_CODE.has(value) ? value : fallback;
}

/** Targets may be crypto. Nothing breaks when a target has no rate: it is skipped. */
function validCodeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === 'string' && ASSET_BY_CODE.has(item)) seen.add(item);
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
    // Normalised, never validated: `updateSettings` writes this object straight
    // back, so anything dropped here is deleted from the user's list for good.
    disabledSites: Array.isArray(input.disabledSites)
      ? [...new Set(
          input.disabledSites
            .filter((s): s is string => typeof s === 'string')
            .map(normalizeHostname)
            .filter((s) => s !== '')
        )]
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
    cryptoEnabled: input.cryptoEnabled === true,
  };
}

/** True when a crypto row would actually be shown, which is what gates the fetch. */
export function wantsCrypto(settings: Settings): boolean {
  return settings.cryptoEnabled && settings.targetCurrencies.some(isCryptoCode);
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

/**
 * `stored`: real data was read back.
 * `empty`:  the read worked and there was nothing there yet (first run).
 * `failed`: the read itself failed, so `settings` is a guess and writing it back
 *           would persist defaults over data we simply could not see.
 */
export type SettingsSource = 'stored' | 'empty' | 'failed';

export interface SettingsLoad {
  source: SettingsSource;
  settings: Settings;
  error?: unknown;
}

function firstRunSettings(): Settings {
  return {
    ...defaultSettings(),
    targetCurrencies: DEFAULT_CURRENCIES.filter((c) => c !== DEFAULT_SETTINGS.baseCurrency),
  };
}

/**
 * Never rejects, but says where the answer came from. A UI that cannot tell a
 * failed read from an empty one will happily overwrite everything on the user's
 * next click.
 */
export async function readSettings(): Promise<SettingsLoad> {
  try {
    const stored = await chrome.storage.local.get([STORAGE.SETTINGS, STORAGE.CURRENCIES]);
    if (stored?.[STORAGE.SETTINGS]) {
      return { source: 'stored', settings: parseSettings(stored[STORAGE.SETTINGS]) };
    }

    const migrated = migrateLegacy(stored?.[STORAGE.CURRENCIES]);
    if (migrated) {
      await saveSettings(migrated).catch(() => {});
      return { source: 'stored', settings: migrated };
    }
  } catch (error) {
    // Storage can be stubbed (some extension wrappers) and defaults still work.
    return { source: 'failed', settings: firstRunSettings(), error };
  }
  return { source: 'empty', settings: firstRunSettings() };
}

/** Usable settings, whatever happened. Callers that must not write use this one. */
export async function loadSettings(): Promise<Settings> {
  return (await readSettings()).settings;
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

/**
 * A patch, or a function receiving what storage holds right now. Use the
 * function form whenever the new value is derived from the old one (every list:
 * paused sites, target currencies), otherwise the array is computed from the
 * caller's snapshot and carries its staleness into the write.
 */
export type SettingsPatch = Partial<Settings> | ((current: Settings) => Partial<Settings>);

async function applyUpdate(patch: SettingsPatch): Promise<Settings> {
  const load = await readSettings();
  if (load.source === 'failed') throw load.error ?? new Error('settings could not be read');

  const resolved = typeof patch === 'function' ? patch(load.settings) : patch;
  const next = parseSettings({ ...load.settings, ...resolved });
  await saveSettings(next);
  return next;
}

/** One write at a time: read-modify-write interleaved is the same lost update, inside one document. */
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Applies a patch to what storage holds *now*, not to whatever the caller read
 * minutes ago. The popup and the options page are separate documents writing the
 * same single key: pausing a site in one and flipping a switch in the other used
 * to hand the whole object back from a stale snapshot, silently unpausing the
 * site. Only the patched fields can change.
 *
 * Rejects rather than guessing when the read failed, so a caller can tell the
 * user the setting was not saved.
 */
export function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const run = writeQueue.then(() => applyUpdate(patch), () => applyUpdate(patch));
  writeQueue = run.catch(() => {});
  return run;
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
