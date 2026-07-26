import type { DetectedPrice } from './types';
import { CURRENCY_BY_CODE } from './currencies';

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
const STRIPPABLE_SPACE = new RegExp(`[${SPACE_CLASS}]`, 'g');

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

function parseMatch(match: RegExpExecArray, textSource?: 'full' | 'direct'): DetectedPrice | null {
  let token: string;
  let rawAmount: string;

  if (match[1]) {
    token = match[1];
    rawAmount = match[2];
  } else if (match[3]) {
    token = match[3];
    rawAmount = match[4];
  } else if (match[6]) {
    token = match[6];
    rawAmount = match[5];
  } else {
    return null;
  }

  const spec = SYMBOL_BY_TOKEN.get(token);
  if (!spec) return null;

  // A single fraction digit reads as a version or a measurement far more often
  // than as a price, and alphabetic tokens are the ones that collide with
  // prose: "PHP 8.2", "Fr 20.5". Sign symbols keep the loose rule.
  if (LETTER_REGEX.test(token) && /[.,]\d$/.test(rawAmount)) return null;

  const amount = normalizeAmount(rawAmount, spec.code);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return {
    amount,
    currencyCode: spec.code,
    matchedText: match[0],
    matchStart: match.index,
    matchEnd: match.index + match[0].length,
    textSource,
  };
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

function tryRegexDetection(text: string): DetectedPrice | null {
  const match = PRICE_REGEX.exec(text);
  if (!match) return null;
  return parseMatch(match);
}

function tryRegexDetectionAll(text: string, textSource: 'full' | 'direct'): DetectedPrice[] {
  GLOBAL_PRICE_REGEX.lastIndex = 0;
  const results: DetectedPrice[] = [];
  let match: RegExpExecArray | null;
  while ((match = GLOBAL_PRICE_REGEX.exec(text)) !== null) {
    const price = parseMatch(match, textSource);
    if (price) results.push(price);
    // A zero-length match cannot happen here, but guard the loop anyway.
    if (GLOBAL_PRICE_REGEX.lastIndex === match.index) GLOBAL_PRICE_REGEX.lastIndex++;
  }
  return results;
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

export function detectPricesFromElement(element: Element): DetectedPrice[] {
  try {
    const semantic = trySemanticDetection(element);
    if (semantic) return [semantic];

    const fullText = element.textContent ?? '';
    // Non-leaf elements with short content are likely price containers (Steam, Amazon…)
    // — use full textContent so nested prices are found, hitboxes handle precision.
    // Long elements use directTextContent to avoid matching entire paragraphs.
    const textSource = element.childElementCount === 0 || fullText.trim().length <= 150
      ? 'full'
      : 'direct';
    const text = textSource === 'full' ? fullText : directTextContent(element);

    if (!text.trim()) return [];
    return tryRegexDetectionAll(text, textSource);
  } catch {
    return [];
  }
}

export function detectPriceFromText(text: string): DetectedPrice | null {
  try {
    return tryRegexDetection(text.trim());
  } catch {
    return null;
  }
}

/** Exposed for tests: the exact text a detector run would match. */
export function detectAllFromText(text: string): DetectedPrice[] {
  return tryRegexDetectionAll(text, 'full');
}
