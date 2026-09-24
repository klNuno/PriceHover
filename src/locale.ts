import {
  FAMILIES, FAMILY_BY_TOKEN, FAMILY_CODES, FAMILY_DEFAULT, REGION_CURRENCY, familyOfCode,
} from './families';
import type { Family, FamilyChoice } from './families';

/**
 * A handful of currency tokens are shared by several countries. Read literally,
 * they produce a confidently wrong conversion. `$49` on amazon.ca became
 * 49 USD, `1 099 kr` on a Norwegian shop became SEK. That is worse than showing
 * nothing, because the user has no way to tell it happened.
 *
 * The page itself carries the answer, in more or less trustworthy places. In
 * the order they are believed:
 *
 * 1. The user's lock for the site. Nothing overrides a choice made by hand.
 * 2. The row the price sits in. `Chinese Yuan Renminbi … ¥ 69` is a yuan price
 *    on a page that also lists yen, so nothing page-wide can answer for it.
 * 3. The site: a ccTLD is chosen for a market, and a region subtag in
 *    `<html lang>` says which one.
 * 4. What pages of this site said about themselves, remembered. A currency
 *    picker reading `CNY`, an `og:price:currency`, prices written `$49 CAD`.
 *    Below the site's own signals on purpose: scraped text helps often and is
 *    wrong more often than a domain.
 *
 * None of it needs a permission: the content script already runs in the page.
 */

/** Stands in for `$`, `kr` and `¥`: every other token reads as what it says. */
export interface TokenResolver {
  (token: string, defaultCode: string): string;
  /**
   * Tokens whose reading the user locked by hand. The tooltip says when the
   * extension guessed a currency; a currency the user chose is not a guess.
   */
  readonly locked?: ReadonlySet<string>;
}

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

/** What the site's own domain and language say, per family. */
export function regionChoice(hostname: string, language: string): FamilyChoice {
  const region = regionFromPage(hostname, language);
  if (!region) return {};
  const choice: FamilyChoice = {};
  for (const family of FAMILIES) {
    const code = REGION_CURRENCY[family][region];
    if (code && FAMILY_CODES[family].includes(code)) choice[family] = code;
  }
  return choice;
}

export interface ResolverSources {
  /** The user's lock for this site: one code, which fixes the family it belongs to. */
  locked?: string | null;
  /** The row a price sits in. See `rowChoice`. */
  context?: FamilyChoice;
  /** Remembered from earlier pages of the same site. See `pageChoice`. */
  learned?: FamilyChoice;
  /** False reads only the lock: the user switched page context off. */
  usePage?: boolean;
}

/**
 * Returns `null` when nothing changes any reading, so the detector can skip the
 * indirection entirely on the majority of pages.
 */
export function makeTokenResolver(
  hostname: string,
  language: string,
  sources: ResolverSources = {}
): TokenResolver | null {
  const usePage = sources.usePage !== false;
  const lockedFamily = sources.locked ? familyOfCode(sources.locked) : null;
  const layers: FamilyChoice[] = [
    lockedFamily ? { [lockedFamily]: sources.locked! } : {},
    ...(usePage ? [sources.context ?? {}, regionChoice(hostname, language), sources.learned ?? {}] : []),
  ];

  const byFamily = new Map<Family, string>();
  for (const family of FAMILIES) {
    const code = layers.find((layer) => layer[family])?.[family];
    if (code && code !== FAMILY_DEFAULT[family]) byFamily.set(family, code);
  }

  const locked = new Set<string>();
  if (lockedFamily) {
    for (const [token, family] of FAMILY_BY_TOKEN) if (family === lockedFamily) locked.add(token);
  }
  if (!byFamily.size && !locked.size) return null;

  const overrides = new Map<string, string>();
  for (const [token, family] of FAMILY_BY_TOKEN) {
    const code = byFamily.get(family);
    if (code) overrides.set(token, code);
  }
  const resolve = (token: string, defaultCode: string): string =>
    overrides.get(token.replace(/\s/g, '')) ?? defaultCode;
  return Object.assign(resolve, { locked });
}

// ── What a page says about itself ──────────────────────────────────────────

/**
 * Names a currency is written out as. Row context only: prose mentions a
 * currency by name for every reason under the sun, but a table row that says
 * "Chinese Yuan Renminbi" is labelling the price beside it.
 *
 * `元` is left out: it is also plain Japanese and Chinese vocabulary. `円` is
 * not, and it is how a Japanese page writes yen.
 */
const CURRENCY_NAMES: Record<string, RegExp> = {
  USD: /\b(?:U\.?\s?S\.?|American|United States)\s+dollars?\b|dollars?\s+américains?|dólar(?:es)?\s+estadounidenses?/iu,
  CAD: /\bCanadian\s+dollars?\b|dollars?\s+canadiens?|dólar(?:es)?\s+canadienses?|kanadische[rn]?\s+Dollar/iu,
  AUD: /\bAustralian\s+dollars?\b|dollars?\s+australiens?|dólar(?:es)?\s+australianos?/iu,
  NZD: /\bNew\s+Zealand\s+dollars?\b|dollars?\s+néo-zélandais/iu,
  SGD: /\bSingapore\s+dollars?\b|dollars?\s+de\s+Singapour/iu,
  HKD: /\bHong\s+Kong\s+dollars?\b|dollars?\s+de\s+Hong\s+Kong|港币|港幣/iu,
  MXN: /\bMexican\s+pesos?\b|pesos?\s+mexicanos?/iu,
  CLP: /\bChilean\s+pesos?\b|pesos?\s+chilenos?/iu,
  UYU: /\bUruguayan\s+pesos?\b|pesos?\s+uruguayos?/iu,
  TWD: /\b(?:New\s+)?Taiwan(?:ese)?\s+dollars?\b|新台幣|新台币/iu,
  BRL: /\bBrazilian\s+reals?\b|\breais\b|\breal\s+brasileiro\b/iu,
  SEK: /\bSwedish\s+kron(?:a|or)\b|\bsvenska\s+kronor\b/iu,
  NOK: /\bNorwegian\s+kron(?:e|er)\b|\bnorske\s+kroner\b/iu,
  DKK: /\bDanish\s+kron(?:e|er)\b|\bdanske\s+kroner\b/iu,
  ISK: /\bIcelandic\s+kr[oó]n(?:a|ur)\b|íslenskar\s+krónur/iu,
  JPY: /\byen\b|円|日元|日圓/iu,
  CNY: /\byuan\b|\brenminbi\b|\bRMB\b|人民币|人民幣/iu,
};

const AMBIGUOUS_CODES = FAMILIES.flatMap((family) => FAMILY_CODES[family]);

/** An ISO code standing alone, never inside a word or a number: `CAD`, not `CADENCE`. */
const CODE_MENTION = new RegExp(`(?<![\\p{L}\\d])(${AMBIGUOUS_CODES.join('|')})(?![\\p{L}\\d])`, 'gu');

function codeMentions(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(CODE_MENTION)) {
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return counts;
}

/**
 * A reading for each family the row names exactly one currency of.
 *
 * `explicit` holds the currencies the row already prints unambiguously: `CDN$`,
 * `NT$ 1,190`, `CAD 54.99`. A row that does that and also has a bare `$` is
 * using the bare one for something else, which on SteamDB is the converted
 * US price beside the Canadian one. Such a family is left alone.
 */
export function rowChoice(text: string, explicit: ReadonlySet<string>): FamilyChoice {
  const mentioned = new Set(codeMentions(text).keys());
  for (const [code, pattern] of Object.entries(CURRENCY_NAMES)) {
    if (pattern.test(text)) mentioned.add(code);
  }

  const choice: FamilyChoice = {};
  for (const family of FAMILIES) {
    const codes = FAMILY_CODES[family].filter((code) => mentioned.has(code));
    if (codes.length === 1 && !explicit.has(codes[0])) choice[family] = codes[0];
  }
  return choice;
}

/** Points per signal, weakest last. See `pageChoice`. */
const DECLARED_WEIGHT = 5;
const PRICED_WEIGHT = 2;
const MENTION_WEIGHT = 1;
/** Below this, a page has not said enough to be remembered for a whole site. */
const MIN_SCORE = 3;
/** The winner has to outweigh the runner-up this many times over. */
const MIN_LEAD = 3;

export interface PageSignals {
  /** The page's text, or a bounded sample of it. */
  text: string;
  /** Currencies the markup declares: `og:price:currency`, `itemprop="priceCurrency"`. */
  declared: readonly string[];
  /** How many prices the page writes unambiguously in each currency. */
  priced: ReadonlyMap<string, number>;
}

/**
 * What a page says its currency is, per family, when it says it clearly.
 *
 * Only machine-readable signals count: a declaration in the markup, a price
 * written with its code (`$49 CAD`, `C$ 49`), and a bare code, which is what a
 * shop's currency picker prints. Currency names in prose do not: a news story
 * about the Canadian dollar says nothing about the site's prices.
 *
 * It has to be clear because it is remembered for the whole site. A page that
 * lists a dozen currencies (SteamDB) decides nothing, and neither does one
 * that mentions `CAD` once.
 */
export function pageChoice(signals: PageSignals): FamilyChoice {
  const scores = new Map<string, number>();
  const add = (code: string, points: number): void => {
    if (familyOfCode(code)) scores.set(code, (scores.get(code) ?? 0) + points);
  };
  for (const code of signals.declared) add(code, DECLARED_WEIGHT);
  for (const [code, count] of signals.priced) add(code, count * PRICED_WEIGHT);
  for (const [code, count] of codeMentions(signals.text)) add(code, count * MENTION_WEIGHT);

  const choice: FamilyChoice = {};
  for (const family of FAMILIES) {
    const ranked = FAMILY_CODES[family]
      .map((code) => [code, scores.get(code) ?? 0] as const)
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1]);
    const [top, second] = ranked;
    if (!top || top[1] < MIN_SCORE) continue;
    if (second && top[1] < second[1] * MIN_LEAD) continue;
    choice[family] = top[0];
  }
  return choice;
}
