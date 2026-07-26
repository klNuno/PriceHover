import type { DetectedPrice } from './types';
import { CURRENCY_BY_CODE } from './currencies';
import type { TokenResolver } from './locale';

/**
 * Where a currency token is allowed to sit relative to its amount.
 *
 * Matching is case-sensitive on purpose: with an `i` flag, ISO codes swallow
 * ordinary English ("try 100 times" → TRY 100, "php 8.2" → PHP 8.2).
 *
 * `prefix` — token before the amount, with at most one space (`RM 5`).
 * `suffix` — token after the amount, with at most one space (`199 kr`).
 * `tight`  — prefix that must touch the digits (`R100`). Reserved for tokens so
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
  // Sign symbols — unambiguous, allowed on either side.
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

export const SYMBOL_BY_TOKEN = new Map(SYMBOLS.map((s) => [s.token, s]));

/**
 * Space characters allowed beside or inside an amount. Newlines are excluded on
 * purpose: a price never straddles two lines, but a paragraph break would let
 * unrelated text join up into one match.
 */
const SPACE_CLASS = ' \\u00A0\\u202F\\u2009';
const SPACE = `[${SPACE_CLASS}]`;
const GROUP_SEP = `[,.${SPACE_CLASS}]`;

/**
 * Three shapes, tried in order:
 * 1. Indian grouping — 1,49,900 / 12,34,567.89 (two-digit groups above the
 *    first thousand). Must come first: the western pattern would match only
 *    the leading digit and the boundary lookahead would then reject the lot.
 * 2. western grouping — 1,234.56 / 1.234,56 / 1 234,56
 * 3. plain digit run — 746000 / 22000 (common in VND, IDR, KZT…)
 *
 * Up to three decimals so KWD and friends survive; the boundary lookahead
 * below rejects anything longer instead of silently truncating it.
 */
const AMOUNT =
  '(?:' +
  `\\d{1,2}(?:,\\d{2})+,\\d{3}(?:\\.\\d{1,2})?` +
  `|\\d{1,3}(?:${GROUP_SEP}\\d{3}){1,5}(?:[,.]\\d{1,2})?` +
  `|\\d+(?:[,.]\\d{1,3})?` +
  ')';

function escapeToken(token: string): string {
  // No `/` here: under the `u` flag `\/` is an invalid identity escape.
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Longest first, so `SAR` wins over `SR` and `R$` over `R`. */
function alternation(specs: SymbolSpec[]): string {
  return specs
    .map((s) => s.token)
    .sort((a, b) => b.length - a.length)
    .map(escapeToken)
    .join('|');
}

const TIGHT_ALT = alternation(SYMBOLS.filter((s) => s.tight));
const PREFIX_ALT = alternation(SYMBOLS.filter((s) => s.prefix));
const SUFFIX_ALT = alternation(SYMBOLS.filter((s) => s.suffix));

// Group layout: 1=tight token, 2=amount | 3=prefix token, 4=amount
//               5=amount, 6=suffix token
//
// Leading lookbehinds keep a match from starting mid-token. The amount-first
// branch also refuses a leading `.` or `,` so "1.2345 USD" cannot be salvaged
// as "2345 USD". The trailing lookahead refuses a truncated amount, so
// "€1234.5678" yields nothing rather than a wrong €1234.56.
const PRICE_SOURCE =
  `(?:(?<![\\p{L}\\d])(${TIGHT_ALT})(${AMOUNT})` +
  `|(?<![\\p{L}\\d])(${PREFIX_ALT})${SPACE}?(${AMOUNT})` +
  `|(?<![\\p{L}\\d.,])(${AMOUNT})${SPACE}?(${SUFFIX_ALT}))` +
  `(?![\\p{L}\\d])(?![.,]\\d)`;

const PRICE_REGEX = new RegExp(PRICE_SOURCE, 'u');
const GLOBAL_PRICE_REGEX = new RegExp(PRICE_SOURCE, 'gu');

const LETTER_REGEX = /\p{L}/u;
const DIGIT_REGEX = /\d/;
const STRIPPABLE_SPACE = new RegExp(`[${SPACE_CLASS}]`, 'g');

/**
 * Upper half of a range: a dash, then a bare amount. `%` and `‰` are excluded
 * so "€10-20% off" stays a single price rather than becoming a €10–€20 range.
 */
const RANGE_DASH = `${SPACE}*[-‐‑‒–—~]${SPACE}*`;
const RANGE_AFTER = new RegExp(`^${RANGE_DASH}(${AMOUNT})(?![\\p{L}\\d%‰])`, 'u');
const RANGE_BEFORE = new RegExp(`(?<![\\p{L}\\d.,])(${AMOUNT})${RANGE_DASH}$`, 'u');
const RANGE_BETWEEN = new RegExp(`^${RANGE_DASH}$`, 'u');

/** Currencies whose minor unit is three digits, so `1.234` really is 1.234. */
const THREE_DECIMAL_CURRENCIES = new Set(['KWD', 'BHD', 'OMR', 'JOD', 'TND']);

export function normalizeAmount(raw: string, code: string): number {
  const s = raw.replace(STRIPPABLE_SPACE, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma === -1 && lastDot === -1) return parseFloat(s);

  // Both separators present: the rightmost one is the decimal point, unless it
  // is followed by three digits — then both are thousands separators.
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalIndex = Math.max(lastComma, lastDot);
    if (s.length - decimalIndex - 1 === 3) return parseFloat(s.replace(/[,.]/g, ''));
    const integerPart = s.slice(0, decimalIndex).replace(/[,.]/g, '');
    return parseFloat(`${integerPart}.${s.slice(decimalIndex + 1)}`);
  }

  // A single kind of separator. Repeated means grouping (1.234.567). Otherwise
  // the digit count decides: three digits is a thousands separator (3,500 →
  // 3500) for every currency that does not use three decimals.
  const separator = lastComma !== -1 ? ',' : '.';
  const separatorCount = s.split(separator).length - 1;
  const digitsAfter = s.length - Math.max(lastComma, lastDot) - 1;

  if (separatorCount > 1) return parseFloat(s.split(separator).join(''));
  if (digitsAfter === 3 && !THREE_DECIMAL_CURRENCIES.has(code)) {
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
  } else if (match[6]) {
    token = match[6];
    rawAmount = match[5];
    side = 'after';
  } else {
    return null;
  }

  const spec = SYMBOL_BY_TOKEN.get(token);
  if (!spec) return null;

  // A single fraction digit reads as a version or a measurement far more often
  // than as a price, and alphabetic tokens are the ones that collide with
  // prose: "PHP 8.2", "Fr 20.5". Sign symbols keep the loose rule.
  if (LETTER_REGEX.test(token) && /[.,]\d$/.test(rawAmount)) return null;

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
      // Only when the page actually changed the reading — a `$` on a .ca domain,
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

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const price = current.price;
    const start = price.matchStart!;
    const end = price.matchEnd!;

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
          out.push({ ...price, amountMax: max, matchEnd: end + tail[0].length });
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
  const match = PRICE_REGEX.exec(text);
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
  for (const match of text.matchAll(GLOBAL_PRICE_REGEX)) {
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
    // — use full textContent so nested prices are found, hitboxes handle precision.
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
