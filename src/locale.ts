import { CURRENCY_BY_CODE } from './currencies';

/**
 * A handful of currency tokens are shared by several countries. Read literally,
 * they produce a confidently wrong conversion. `$49` on amazon.ca became
 * 49 USD, `1 099 kr` on a Norwegian shop became SEK. That is worse than showing
 * nothing, because the user has no way to tell it happened.
 *
 * The page itself carries the answer: a ccTLD is chosen for a market, and a
 * region subtag in `<html lang>` says which one. Neither needs a permission,
 * since the content script already runs in that page.
 */

/** Token families that mean different currencies in different places. */
const FAMILY_BY_TOKEN = new Map<string, string>([
  ['$', '$'],
  ['kr', 'kr'], ['kr.', 'kr'], ['Kr', 'kr'],
  ['¥', '¥'], ['￥', '¥'],
]);

/**
 * Region → currency, per family. A region absent from a family's table leaves
 * the token at its default reading, so an unlisted country never makes things
 * worse than they are today.
 */
const REGION_CURRENCY: Record<string, Record<string, string>> = {
  '$': {
    US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD',
    MX: 'MXN', CL: 'CLP', UY: 'UYU', TW: 'TWD', BR: 'BRL',
  },
  kr: { SE: 'SEK', NO: 'NOK', DK: 'DKK', IS: 'ISK' },
  '¥': { JP: 'JPY', CN: 'CNY' },
};

/**
 * ccTLDs trusted as a market signal. Deliberately excludes the ones sold as
 * generic vanity domains (`.co`, `.io`, `.me`, `.ai`, `.tv`, `.to`, `.cc`),
 * where the country has nothing to do with the site.
 */
const MARKET_CCTLD = new Set([
  'ae', 'at', 'au', 'be', 'br', 'ca', 'ch', 'cl', 'cn', 'cr', 'cz', 'de', 'dk',
  'es', 'fi', 'fr', 'gr', 'hk', 'hu', 'id', 'ie', 'il', 'in', 'is', 'it', 'jp',
  'kr', 'kw', 'kz', 'mx', 'my', 'ng', 'nl', 'no', 'nz', 'pe', 'ph', 'pl', 'pt',
  'qa', 'ro', 'ru', 'sa', 'se', 'sg', 'th', 'tr', 'tw', 'ua', 'uk', 'uy', 'vn',
  'za',
]);

/** `.uk` is the only market ccTLD whose ISO 3166 region code differs. */
const CCTLD_REGION_OVERRIDE: Record<string, string> = { uk: 'GB' };

export function regionFromHostname(hostname: string): string | null {
  const tld = hostname.toLowerCase().split('.').pop() ?? '';
  if (!MARKET_CCTLD.has(tld)) return null;
  return CCTLD_REGION_OVERRIDE[tld] ?? tld.toUpperCase();
}

/** `en-CA` → `CA`. Ignores `en` and `en-Latn` (script subtag, not a region). */
export function regionFromLanguage(language: string): string | null {
  const match = /^[a-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2})\b/.exec(language.trim());
  return match ? match[1].toUpperCase() : null;
}

/**
 * The domain wins over `<html lang>`: a ccTLD is a deliberate choice of market,
 * while a lang attribute is boilerplate that gets copied between deployments.
 */
export function regionFromPage(hostname: string, language: string): string | null {
  return regionFromHostname(hostname) ?? regionFromLanguage(language);
}

export type TokenResolver = (token: string, defaultCode: string) => string;

/**
 * Returns `null` when the page's region changes nothing, so the detector can
 * skip the indirection entirely on the majority of pages.
 */
export function makeTokenResolver(hostname: string, language: string): TokenResolver | null {
  const region = regionFromPage(hostname, language);
  if (!region) return null;

  const overrides = new Map<string, string>();
  for (const [token, family] of FAMILY_BY_TOKEN) {
    const code = REGION_CURRENCY[family]?.[region];
    if (code && CURRENCY_BY_CODE.has(code)) overrides.set(token, code);
  }
  if (!overrides.size) return null;

  return (token, defaultCode) => overrides.get(token) ?? defaultCode;
}
