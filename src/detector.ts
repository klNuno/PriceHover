import type { DetectedPrice } from './types';
import { isCryptoCode } from './crypto';
import { CURRENCY_BY_CODE } from './currencies';
import type { TokenResolver } from './locale';

/**
 * Where a currency token is allowed to sit relative to its amount.
 *
 * Matching is case-sensitive on purpose: with an `i` flag, ISO codes swallow
 * ordinary English ("try 100 times" → TRY 100, "php 8.2" → PHP 8.2).
 *
 * `prefix`: token before the amount, with at most one space (`RM 5`).
 * `suffix`: token after the amount, with at most one space (`199 kr`).
 * `tight`:  prefix that must touch the digits (`R100`). Reserved for tokens so
 *            short that the spaced form matches prose ("see section R 5").
 */
interface SymbolSpec {
  token: string;
  code: string;
  prefix: boolean;
  suffix: boolean;
  tight: boolean;
}

const both = (token: string, code: string): SymbolSpec =>
  ({ token, code, prefix: true, suffix: true, tight: false });
const prefixOnly = (token: string, code: string): SymbolSpec =>
  ({ token, code, prefix: true, suffix: false, tight: false });
const tightPrefix = (token: string, code: string): SymbolSpec =>
  ({ token, code, prefix: false, suffix: false, tight: true });

const SYMBOLS: SymbolSpec[] = [
  // Sign symbols, unambiguous, allowed on either side.
  both('$', 'USD'), both('€', 'EUR'), both('£', 'GBP'), both('¥', 'JPY'),
  both('￥', 'JPY'), both('₹', 'INR'), both('₩', 'KRW'), both('₦', 'NGN'),
  both('₱', 'PHP'), both('฿', 'THB'), both('₺', 'TRY'), both('₽', 'RUB'),
  both('₴', 'UAH'), both('₫', 'VND'), both('₸', 'KZT'), both('₪', 'ILS'),
  both('₡', 'CRC'), both('﷼', 'SAR'), both('د.إ', 'AED'),

  // Qualified dollar and peso variants.
  both('US$', 'USD'), both('COL$', 'COP'), both('CLP$', 'CLP'),
  both('NT$', 'TWD'), both('CDN$', 'CAD'), both('Mex$', 'MXN'),
  both('MX$', 'MXN'), both('CA$', 'CAD'), both('HK$', 'HKD'),
  both('NZ$', 'NZD'), both('A$', 'AUD'), both('R$', 'BRL'),
  both('S$', 'SGD'), both('$U', 'UYU'),
  // Canada and Australia print the short forms at least as often as CA$/A$.
  both('C$', 'CAD'), both('AU$', 'AUD'),

  // Peru writes both forms.
  both('S/.', 'PEN'), both('S/', 'PEN'),

  // Alphabetic tokens that read as a currency only in front of the amount.
  // As a suffix they would match "error code 500 KD" or "Version 5 RM".
  prefixOnly('Rp', 'IDR'), prefixOnly('RM', 'MYR'), prefixOnly('SR', 'SAR'),
  prefixOnly('QR', 'QAR'), prefixOnly('KD', 'KWD'),

  // Alphabetic tokens genuinely written on both sides. The dotted forms are how
  // Switzerland and Denmark actually print them: "Fr. 89.90", "199 kr."
  both('Fr.', 'CHF'), both('Fr', 'CHF'),
  both('kr.', 'SEK'), both('kr', 'SEK'), both('Kr', 'SEK'),
  both('zł', 'PLN'), both('Kč', 'CZK'), both('Ft', 'HUF'),

  // A bare R is South African rand only when glued to the digits.
  tightPrefix('R', 'ZAR'),

  // Every ISO 4217 code we support, uppercase only.
  ...[...CURRENCY_BY_CODE.keys()].map((code) => both(code, code)),
];

/**
 * Crypto tokens, and deliberately not one per convertible asset.
 *
 * Twenty-four assets can be converted *to*; nine tickers plus two glyphs are
 * believed when they appear *on a page*, because the two lists have completely
 * different costs. A new target costs nothing: it rides the same request. A new
 * token costs a class of false positive, and this file has paid that bill
 * before with `error code 500 KD` and `try 100 times`.
 *
 * Left out on purpose:
 * - `ATOM`, `LINK`, `NEAR`, `TON`, `DOT`, `UNI`, `APT`, `FIL`, `ARB`, `OP`,
 *   `ETC`, `ADA`: ordinary words and abbreviations in an all-caps heading.
 * - `SOL`: it is the name of the Peruvian sol, which this extension already
 *   converts. "SOL 30" on a Peruvian page is soles, and reading it as Solana
 *   would be wrong rather than merely noisy.
 * - `Ł`: Polish orthography.
 * - `sats` as a suffix: "1000 sats" is a price and also a username.
 */
const CRYPTO_SYMBOLS: SymbolSpec[] = [
  both('₿', 'BTC'), both('Ξ', 'ETH'),
  ...['BTC', 'ETH', 'XMR', 'USDT', 'USDC', 'DOGE', 'XRP', 'LTC', 'BCH']
    .map((code) => both(code, code)),
];

export const SYMBOL_BY_TOKEN = new Map(
  [...SYMBOLS, ...CRYPTO_SYMBOLS].map((s) => [s.token, s])
);

/**
 * Space characters allowed beside or inside an amount. Newlines are excluded on
 * purpose: a price never straddles two lines, but a paragraph break would let
 * unrelated text join up into one match.
 */
const SPACE_CLASS = ' \\u00A0\\u2000-\\u200A\\u202F';
const SPACE = `[${SPACE_CLASS}]`;
const GROUP_SEP = `[,.${SPACE_CLASS}]`;

/**
 * Three shapes, tried in order:
 * 1. Indian grouping: 1,49,900 / 12,34,567.89 (two-digit groups above the
 *    first thousand). Must come first: the western pattern would match only
 *    the leading digit and the boundary lookahead would then reject the lot.
 * 2. western grouping: 1,234.56 / 1.234,56 / 1 234,56
 * 3. plain digit run: 746000 / 22000 (common in VND, IDR, KZT…)
 *
 * Up to three decimals so KWD and friends survive; the boundary lookahead
 * below rejects anything longer instead of silently truncating it.
 *
 * The plain run is capped at twelve digits. Past that it is an order number, a
 * hash or an id, and the boundary lookahead turns the overflow into no match at
 * all rather than into a price of ten quintillion.
 */
const AMOUNT =
  '(?:' +
  `\\d{1,2}(?:,\\d{2})+,\\d{3}(?:\\.\\d{1,2})?` +
  `|\\d{1,3}(?:${GROUP_SEP}\\d{3}){1,5}(?:[,.]\\d{1,2})?` +
  `|0[,.]\\d{1,6}` +
  `|\\d{1,12}(?:[,.]\\d{1,3})?` +
  ')';

/**
 * The fourth shape is a price below one unit, and only that: a leading zero,
 * then up to six decimals. `$0.0075 per 1K tokens` and `€0.000015 per unit` are
 * how prorated and per-unit prices are printed, and three decimals matched none
 * of them, so those prices were invisible rather than wrong.
 *
 * The integer branch keeps its three, because a fourth decimal there is what
 * `€1234.5678` is: a rate, a coordinate, a measurement. Both of those already
 * had a rejection test and both still hold.
 *
 * Crypto gets eight, a bitcoin's own minor unit, in a shape of its own so that
 * widening it can never touch a fiat match. The Indian grouping branch is left
 * out: nobody prints lakh of ether.
 */
const CRYPTO_AMOUNT =
  '(?:' +
  `\\d{1,3}(?:${GROUP_SEP}\\d{3}){1,5}(?:[,.]\\d{1,2})?` +
  `|\\d{1,12}(?:[,.]\\d{1,8})?` +
  ')';

function escapeToken(token: string): string {
  // No `/` here: under the `u` flag `\/` is an invalid identity escape.
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Longest first, so `SAR` wins over `SR` and `R$` over `R`.
 *
 * A qualified dollar is printed both ways, `CA$30` and `CA $30`, so the sign is
 * allowed to sit one space from its qualifier. Without that, `CA $30` matched
 * the bare `$` and read as thirty US dollars. The captured token keeps the
 * space; the lookup in `SYMBOL_BY_TOKEN` strips it.
 */
function alternation(specs: SymbolSpec[]): string {
  return specs
    .map((s) => s.token)
    .sort((a, b) => b.length - a.length)
    .map((token) =>
      token.length > 1 && token.endsWith('$')
        ? `${escapeToken(token.slice(0, -1))}${SPACE}?\\$`
        : escapeToken(token)
    )
    .join('|');
}

/** An ISO code stands for itself; every other token is a printed symbol. */
const isCode = (s: SymbolSpec): boolean => s.token === s.code;

const TIGHT_ALT = alternation(SYMBOLS.filter((s) => s.tight));
const PREFIX_ALT = alternation(SYMBOLS.filter((s) => s.prefix && !isCode(s)));
const CODE_ALT = alternation(SYMBOLS.filter((s) => s.prefix && isCode(s)));
const SUFFIX_ALT = alternation(SYMBOLS.filter((s) => s.suffix));

// Group layout: 1=tight token, 2=amount | 3=symbol token, 4=amount
//               5=ISO code, 6=amount | 7=amount, 8=suffix token
//
// Leading lookbehinds keep a match from starting mid-token. The amount-first
// branch also refuses a leading `.` or `,` so "1.2345 USD" cannot be salvaged
// as "2345 USD". The trailing lookahead refuses a truncated amount, so
// "€1234.5678" yields nothing rather than a wrong €1234.56.
//
// An ISO code gets its own branch because it needs the space the symbols do
// not: `RM5` and `Rp5000` are how those are printed, while a three-letter code
// glued to digits is `CRC32`, `PHP7`, `COP21`, and never a price.
const PRICE_SOURCE =
  `(?:(?<![\\p{L}\\d])(${TIGHT_ALT})(${AMOUNT})` +
  `|(?<![\\p{L}\\d])(${PREFIX_ALT})${SPACE}?(${AMOUNT})` +
  `|(?<![\\p{L}\\d])(${CODE_ALT})${SPACE}(${AMOUNT})` +
  `|(?<![\\p{L}\\d.,])(${AMOUNT})${SPACE}?(${SUFFIX_ALT}))` +
  `(?![\\p{L}\\d])(?![.,]\\d)`;

const PRICE_REGEX = new RegExp(PRICE_SOURCE, 'u');
const GLOBAL_PRICE_REGEX = new RegExp(PRICE_SOURCE, 'gu');

/**
 * Group layout continues where the fiat source stopped:
 *   9=glyph, 10=amount | 11=code, 12=amount | 13=amount, 14=token
 *
 * A glyph may touch its digits (`₿0.05`); a ticker may not (`BTC 0.05`), for
 * the same reason `CRC32` and `PHP7` are not prices.
 */
function cryptoSource(): string {
  const glyphs = alternation(CRYPTO_SYMBOLS.filter((s) => !isCode(s)));
  const codes = alternation(CRYPTO_SYMBOLS.filter(isCode));
  const every = alternation(CRYPTO_SYMBOLS);

  return (
    `(?:(?<![\\p{L}\\d])(${glyphs})${SPACE}?(${CRYPTO_AMOUNT})` +
    `|(?<![\\p{L}\\d])(${codes})${SPACE}(${CRYPTO_AMOUNT})` +
    `|(?<![\\p{L}\\d.,])(${CRYPTO_AMOUNT})${SPACE}?(${every}))` +
    `(?![\\p{L}\\d])(?![.,]\\d)`
  );
}

/**
 * Two compiled sources rather than one that always carries crypto: a profile
 * with the feature off runs the regex it has always run, over the same pages,
 * at the same cost. The crypto pair is built the first time it is needed and
 * never for anyone else.
 */
let cryptoRegexes: { one: RegExp; all: RegExp } | null = null;
let cryptoDetection = false;

/**
 * Called by the content script from the settings it already reads. Detection is
 * a page-facing behaviour, so it follows the switch rather than the permission:
 * a user who turned crypto off keeps a page of `0.05 BTC` unannotated even
 * while the browser still remembers the grant.
 */
export function setCryptoDetection(enabled: boolean): void {
  cryptoDetection = enabled;
}

function priceRegexes(): { one: RegExp; all: RegExp } {
  if (!cryptoDetection) return { one: PRICE_REGEX, all: GLOBAL_PRICE_REGEX };
  if (!cryptoRegexes) {
    const source = `(?:${PRICE_SOURCE})|(?:${cryptoSource()})`;
    cryptoRegexes = { one: new RegExp(source, 'u'), all: new RegExp(source, 'gu') };
  }
  return cryptoRegexes;
}

const DIGIT_REGEX = /\d/;

/**
 * ISO codes that are also an English word, a language, a checksum or a summit.
 * They are accepted only on an amount printed the way money is printed: a
 * thousands group, or a full two-digit minor unit. `PHP 8.2` is a release,
 * `PHP 1,299` and `PHP 129.99` are prices.
 */
const AMBIGUOUS_CODES = new Set(['PHP', 'TRY', 'CRC', 'COP']);
const PRICE_SHAPED = new RegExp(`(?:[,.]\\d\\d|${GROUP_SEP}\\d{3})`, 'u');

/**
 * What a ticker must not sit next to: a bare run of four digits or more.
 * `ETH 8092` is a Zurich postal code, `XRP 2024` a year, `BTC 10000` a headline
 * number as often as an amount. Anything carrying a separator, and anything
 * short, is left alone: `1,000 USDT`, `BCH 1,299.50`, `500 USDC`, `0.05 BTC`.
 */
const CRYPTO_BARE_INTEGER = /^\d{4,}$/u;

/** Tokens one character away from prose, where a lone digit means noise. */
const NEEDS_TWO_DIGITS = new Set(['R', 'S/']);
const STRIPPABLE_SPACE = new RegExp(`[${SPACE_CLASS}]`, 'g');

/**
 * Upper half of a range: a dash, then a bare amount. `%` and `‰` are excluded
 * so "€10-20% off" stays a single price rather than becoming a €10–€20 range.
 */
const RANGE_DASH = `${SPACE}*[-‐‑‒–—~]${SPACE}*`;
const RANGE_AFTER = new RegExp(
  `^${RANGE_DASH}(${AMOUNT})(?![\\p{L}\\d%‰])(?!${SPACE}*[%‰])`,
  'u'
);
const RANGE_BEFORE = new RegExp(`(?<![\\p{L}\\d.,])(${AMOUNT})${RANGE_DASH}$`, 'u');
const RANGE_BETWEEN = new RegExp(`^${RANGE_DASH}$`, 'u');

/**
 * Currencies whose minor unit is three digits, so `1.234` really is 1.234.
 *
 * Only the dot is affected. Kuwait writes comma thousands and a dot decimal,
 * exactly like the US: `KD 1,250` is a thousand two hundred and fifty dinars,
 * `KD 1.250` is one and a quarter.
 */
const THREE_DECIMAL_CURRENCIES = new Set(['KWD', 'BHD', 'OMR', 'JOD', 'TND']);

/**
 * Same exception, wider reason: `1.005 BTC` is one and a bit, never a thousand
 * and five. It belongs to the dot alone, as it does for the dinar, since a page
 * writing `1,005 USDT` in US notation does mean a thousand.
 */
const isManyDecimal = (code: string): boolean =>
  THREE_DECIMAL_CURRENCIES.has(code) || isCryptoCode(code);

/**
 * What a thousands group has to look like on its left: one to three digits,
 * never a leading zero. `0.001` and `0,001` are thousandths, and reading them
 * as grouping turned a fractional price into 1.
 */
const LEADING_GROUP = /^[1-9]\d{0,2}$/;

export function normalizeAmount(raw: string, code: string): number {
  const s = raw.replace(STRIPPABLE_SPACE, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma === -1 && lastDot === -1) return parseFloat(s);

  // Both separators present: the rightmost one is the decimal point, unless it
  // is followed by three digits, in which case both are thousands separators.
  // A three-decimal currency is the exception, since `1,250.500` is its normal
  // way of printing a price and not a grouped 1250500.
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalIndex = Math.max(lastComma, lastDot);
    const minorUnit = s[decimalIndex] === '.' && isManyDecimal(code);
    if (s.length - decimalIndex - 1 === 3 && !minorUnit) {
      return parseFloat(s.replace(/[,.]/g, ''));
    }
    const integerPart = s.slice(0, decimalIndex).replace(/[,.]/g, '');
    return parseFloat(`${integerPart}.${s.slice(decimalIndex + 1)}`);
  }

  // A single kind of separator. Repeated means grouping (1.234.567). Otherwise
  // the digit count decides: three digits is a thousands separator (3,500 →
  // 3500) when what precedes it can be a group at all.
  const separator = lastComma !== -1 ? ',' : '.';
  const separatorCount = s.split(separator).length - 1;
  const separatorIndex = Math.max(lastComma, lastDot);
  const digitsAfter = s.length - separatorIndex - 1;
  const minorUnit = separator === '.' && isManyDecimal(code);

  if (separatorCount > 1) return parseFloat(s.split(separator).join(''));
  if (digitsAfter === 3 && !minorUnit && LEADING_GROUP.test(s.slice(0, separatorIndex))) {
    return parseFloat(s.split(separator).join(''));
  }
  return parseFloat(s.replace(separator, '.'));
}

/** Where the currency token sat, which decides which way a range can extend. */
type TokenSide = 'before' | 'after';

interface RawMatch {
  price: DetectedPrice;
  side: TokenSide;
}

function parseMatch(
  match: RegExpMatchArray,
  index: number,
  textSource: 'full' | 'direct' | undefined,
  resolve: TokenResolver | undefined
): RawMatch | null {
  let token: string;
  let rawAmount: string;
  let side: TokenSide;

  if (match[1]) {
    token = match[1];
    rawAmount = match[2];
    side = 'before';
  } else if (match[3]) {
    token = match[3];
    rawAmount = match[4];
    side = 'before';
  } else if (match[5]) {
    token = match[5];
    rawAmount = match[6];
    side = 'before';
  } else if (match[8]) {
    token = match[8];
    rawAmount = match[7];
    side = 'after';
  } else if (match[9]) {
    token = match[9];
    rawAmount = match[10];
    side = 'before';
  } else if (match[11]) {
    token = match[11];
    rawAmount = match[12];
    side = 'before';
  } else if (match[14]) {
    token = match[14];
    rawAmount = match[13];
    side = 'after';
  } else {
    return null;
  }

  // `CA $30` captures the space the alternation allowed inside the token.
  const spec = SYMBOL_BY_TOKEN.get(token.replace(STRIPPABLE_SPACE, ''));
  if (!spec) return null;

  // A minus sign in front is a discount line, and converting it to a positive
  // amount says the opposite of what the page says. A dash between two digits
  // is a range and stays allowed.
  const before = match.input?.slice(0, index) ?? '';
  const sign = before.at(-1);
  if ((sign === '-' || sign === '−') && !/\d$/.test(before.slice(0, -1))) return null;

  // These codes are ordinary words or version numbers far more often than
  // money: "Requires PHP 8", "TRY 100 TIMES", "COP 21". A real price in one of
  // them is printed like a price, grouped or with a full minor unit.
  if (AMBIGUOUS_CODES.has(spec.token) && !PRICE_SHAPED.test(rawAmount)) return null;

  // A ticker next to a long round integer is an address, a postal code or an
  // identifier far more often than a price: "ETH 8092" is Zurich. A crypto
  // amount that is really a price either carries a separator or is small.
  if (isCryptoCode(spec.code) && isCode(spec) && CRYPTO_BARE_INTEGER.test(rawAmount)) return null;

  // One digit behind a token this short is an identifier: "R2-D2", "Model S/ 3".
  // A real R5 loses out, which is rarer than the noise the rule keeps out.
  if (NEEDS_TWO_DIGITS.has(spec.token) && /^\d$/.test(rawAmount)) return null;

  // `$`, `kr` and `¥` mean different currencies in different markets. The page
  // resolves them; without a resolver the historical default stands.
  const currencyCode = resolve ? resolve(token, spec.code) : spec.code;

  const amount = normalizeAmount(rawAmount, currencyCode);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return {
    side,
    price: {
      amount,
      currencyCode,
      matchedText: match[0],
      matchStart: index,
      matchEnd: index + match[0].length,
      textSource,
      // Only when the page actually changed the reading: a `$` on a .ca domain,
      // not every `$` in existence. The tooltip says so, and a claim that fires
      // on every price is a claim nobody reads.
      ...(currencyCode !== spec.code ? { inferred: true } : {}),
    },
  };
}

/**
 * Turns two prices, or a price and a bare number, into one range.
 *
 * "€10 – €20" arrives as two complete matches; "€10-20" and "10-20 kr" arrive
 * as one match plus a loose number on the side the token is not on. Both are
 * merged in place so the hitbox still covers the whole printed range.
 */
function mergeRanges(text: string, matches: RawMatch[]): DetectedPrice[] {
  const out: DetectedPrice[] = [];
  // A merged range swallows text a later match already claimed: "€10-20 USD"
  // produced the range and then 20 USD again, so two hitboxes overlapped and
  // the second one won.
  let claimedUntil = 0;

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const price = current.price;
    const start = price.matchStart!;
    const end = price.matchEnd!;

    if (start < claimedUntil) continue;

    // Two full matches with nothing but a dash between them.
    const next = matches[i + 1];
    if (next && next.price.currencyCode === price.currencyCode) {
      const between = text.slice(end, next.price.matchStart!);
      if (RANGE_BETWEEN.test(between) && next.price.amount > price.amount) {
        out.push({ ...price, amountMax: next.price.amount, matchEnd: next.price.matchEnd });
        i++;
        continue;
      }
    }

    // A bare number on the far side of the token: "€10-20", "10-20 kr".
    if (current.side === 'before') {
      const tail = RANGE_AFTER.exec(text.slice(end));
      if (tail) {
        const max = normalizeAmount(tail[1], price.currencyCode);
        if (Number.isFinite(max) && max > price.amount) {
          claimedUntil = end + tail[0].length;
          out.push({ ...price, amountMax: max, matchEnd: claimedUntil });
          continue;
        }
      }
    } else {
      const head = RANGE_BEFORE.exec(text.slice(0, start));
      if (head) {
        const min = normalizeAmount(head[1], price.currencyCode);
        if (Number.isFinite(min) && min > 0 && min < price.amount) {
          out.push({
            ...price,
            amount: min,
            amountMax: price.amount,
            matchStart: start - head[0].length,
          });
          continue;
        }
      }
    }

    out.push(price);
  }

  return out;
}

/** Reads schema.org and data-* annotations, which beat any regex when present. */
function trySemanticDetection(element: Element): DetectedPrice | null {
  let el: Element | null = element;
  let rawAmount: string | null = null;
  let currencyCode: string | null = null;

  const readValue = (target: Element): string =>
    (target.getAttribute('content') ?? target.textContent ?? '').trim();
  const digitsOnly = (value: string): string | null =>
    value.replace(/[^\d.,]/g, '') || null;

  for (let depth = 0; depth < 6 && el; depth++, el = el.parentElement) {
    if (el.hasAttribute('itemprop')) {
      const prop = el.getAttribute('itemprop');
      if (prop === 'price' && rawAmount === null) rawAmount = digitsOnly(readValue(el));
      if (prop === 'priceCurrency' && currencyCode === null) {
        currencyCode = readValue(el).toUpperCase();
      }
    }

    // Real schema.org markup puts price and priceCurrency side by side inside an
    // itemscope, not on the same node and not on an ancestor of each other:
    //   <div itemscope><meta itemprop="priceCurrency" content="JPY">
    //                  <span itemprop="price" content="24800">…</span></div>
    // Walking ancestors alone therefore finds one half and never the other.
    // The lookup is scoped to the itemscope container so it stays cheap.
    if (el.hasAttribute('itemscope')) {
      if (rawAmount === null) {
        const node = el.querySelector('[itemprop="price"]');
        if (node) rawAmount = digitsOnly(readValue(node));
      }
      if (currencyCode === null) {
        const node = el.querySelector('[itemprop="priceCurrency"]');
        if (node) currencyCode = readValue(node).toUpperCase();
      }
    }

    if (el.hasAttribute('data-price') && rawAmount === null) {
      rawAmount = digitsOnly(el.getAttribute('data-price') ?? '');
    }
    if (el.hasAttribute('data-currency') && currencyCode === null) {
      const value = el.getAttribute('data-currency');
      if (value) currencyCode = value.trim().toUpperCase();
    }

    if (rawAmount !== null && currencyCode !== null) break;
  }

  // A currency we cannot convert (loyalty points, "CREDITS") is not a price.
  if (rawAmount === null || currencyCode === null) return null;
  if (!CURRENCY_BY_CODE.has(currencyCode)) return null;

  const amount = normalizeAmount(rawAmount, currencyCode);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return { amount, currencyCode };
}

function tryRegexDetection(text: string, resolve?: TokenResolver): DetectedPrice | null {
  if (!DIGIT_REGEX.test(text)) return null;
  const match = priceRegexes().one.exec(text);
  if (!match) return null;
  const parsed = parseMatch(match, match.index, undefined, resolve);
  if (!parsed) return null;
  return mergeRanges(text, [parsed])[0] ?? null;
}

function tryRegexDetectionAll(
  text: string,
  textSource: 'full' | 'direct',
  resolve?: TokenResolver
): DetectedPrice[] {
  // Every branch of PRICE_SOURCE requires a digit, so text without one cannot
  // match. Skipping the scan turns a 160 µs hover over a paragraph into 0.1 µs,
  // and most of the text on a page has no digit in it at all.
  if (!DIGIT_REGEX.test(text)) return [];

  const raw: RawMatch[] = [];
  // `matchAll` keeps no cursor on the shared regex, so nothing here can be left
  // in a bad state for the next call.
  for (const match of text.matchAll(priceRegexes().all)) {
    const parsed = parseMatch(match, match.index ?? 0, textSource, resolve);
    if (parsed) raw.push(parsed);
  }
  if (!raw.length) return [];
  return mergeRanges(text, raw);
}

/**
 * Get text from direct text nodes only (excludes child element text).
 * Handles cases like <td><span>-20%</span> ¥ 159.71</td> where the price
 * is in a text node alongside child elements.
 */
function directTextContent(element: Element): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  }
  return text;
}

/** Anything `trySemanticDetection` could possibly read. */
const SEMANTIC_SELECTOR = '[itemprop],[itemscope],[data-price],[data-currency]';

export function detectPricesFromElement(element: Element, resolve?: TokenResolver): DetectedPrice[] {
  try {
    // One native selector match beats walking six ancestors and asking each of
    // them for four attributes, and the vast majority of pages carry none of
    // this markup at all.
    if (element.closest(SEMANTIC_SELECTOR)) {
      const semantic = trySemanticDetection(element);
      if (semantic) return [semantic];
    }

    const fullText = element.textContent ?? '';
    // Non-leaf elements with short content are likely price containers (Steam, Amazon…)
    // so use full textContent: nested prices are found, hitboxes handle precision.
    // Long elements use directTextContent to avoid matching entire paragraphs.
    const textSource = element.childElementCount === 0 || fullText.trim().length <= 150
      ? 'full'
      : 'direct';
    const text = textSource === 'full' ? fullText : directTextContent(element);

    if (!text.trim()) return [];
    return tryRegexDetectionAll(text, textSource, resolve);
  } catch {
    return [];
  }
}

export function detectPriceFromText(text: string, resolve?: TokenResolver): DetectedPrice | null {
  try {
    return tryRegexDetection(text.trim(), resolve);
  } catch {
    return null;
  }
}

/** Exposed for tests: the exact text a detector run would match. */
export function detectAllFromText(text: string, resolve?: TokenResolver): DetectedPrice[] {
  return tryRegexDetectionAll(text, 'full', resolve);
}
