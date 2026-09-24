import { CRYPTO_ASSETS, isCryptoCode } from './crypto';
import { CURRENCIES, CURRENCY_BY_CODE } from './currencies';
import { detectPriceFromText, normalizeAmount } from './detector';
import type { DetectedPrice } from './types';

/**
 * The popup's search box is also its calculator, so it has to tell
 * "swiss" (filter the list) from "20 chf" (convert) from "20 chf jpy"
 * (convert into exactly one currency).
 */

/** Words skipped when deriving aliases: geography that belongs to many names. */
const GENERIC_WORDS = new Set([
  'us', 'uk', 'new', 'south', 'north', 'east', 'west', 'hong', 'kong',
  'saudi', 'united', 'arab', 'emirates', 'costa', 'rica', 'de', 'and',
]);

/** Names nobody would derive from the official ISO wording. */
const INFORMAL: [string, string][] = [
  ['dol', 'USD'], ['buck', 'USD'], ['bucks', 'USD'],
  ['rouble', 'RUB'], ['roubles', 'RUB'],
  ['sterling', 'GBP'], ['quid', 'GBP'],
  ['rmb', 'CNY'], ['renminbi', 'CNY'],
  ['reais', 'BRL'],
  ['hryvnia', 'UAH'], ['hry', 'UAH'],
  ['euros', 'EUR'],
];

export const CURRENCY_ALIASES: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const currency of CURRENCIES) {
    map.set(currency.code.toLowerCase(), currency.code);
    for (const word of currency.name.toLowerCase().split(/\s+/)) {
      if (word.length > 2 && !GENERIC_WORDS.has(word) && !map.has(word)) {
        map.set(word, currency.code);
        if (!word.endsWith('s')) map.set(`${word}s`, currency.code); // naive plural
      }
    }
  }
  for (const [alias, code] of INFORMAL) if (!map.has(alias)) map.set(alias, code);
  return map;
})();

/**
 * Tickers and single-word names. Fiat keeps every word it already had: `sol`
 * stays the Peruvian sol, as it does on a page, and Solana is typed `solana`.
 */
export const CRYPTO_ALIASES: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  const add = (alias: string, code: string): void => {
    if (!CURRENCY_ALIASES.has(alias) && !CURRENCY_BY_CODE.has(alias.toUpperCase()) && !map.has(alias)) {
      map.set(alias, code);
    }
  };
  for (const asset of CRYPTO_ASSETS) {
    add(asset.code.toLowerCase(), asset.code);
    if (!/\s/.test(asset.name)) add(asset.name.toLowerCase(), asset.code);
  }
  add('ether', 'ETH');
  add('bitcoins', 'BTC');
  return map;
})();

/** `crypto`: whether crypto names count, which is whether they can be priced. */
export function resolveCurrencyCode(token: string, crypto = false): string | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;

  const alias = CURRENCY_ALIASES.get(normalized);
  if (alias) return alias;

  const upper = normalized.toUpperCase();
  if (CURRENCY_BY_CODE.has(upper)) return upper;
  return crypto ? CRYPTO_ALIASES.get(normalized) ?? null : null;
}

export interface ParsedQuery {
  /** Set when the query reads as an amount to convert. */
  price: DetectedPrice | null;
  /** Set when the query named exactly one destination currency. */
  targetCode: string | null;
  /** Set when the query is plain text to filter the currency list with. */
  filter: string;
}

const NUMERIC_TOKEN = /^[\d,.']+$/;

/**
 * `20 chf` and `chf 20` mean the same thing, and the amount may itself contain
 * spaces ("1 234,56 eur"), so the amount is rebuilt from every numeric token
 * before the detector, which only reads one shape, is asked about it.
 */
function detectAmount(amountTokens: string[], code: string): DetectedPrice | null {
  const amount = amountTokens.join('').replace(/'/g, '');
  if (!amount) return null;
  // Crypto skips the page detector on purpose. Its rules are about telling a
  // price from a postcode (`ETH 8092`) and it believes nine tickers of the
  // twenty-four; neither question arises when the user typed the code.
  if (isCryptoCode(code)) {
    if (!/^[\d,.]+$/.test(amount)) return null;
    const value = normalizeAmount(amount, code);
    return Number.isFinite(value) && value > 0 ? { amount: value, currencyCode: code } : null;
  }
  return detectPriceFromText(`${amount} ${code}`) ?? detectPriceFromText(`${code} ${amount}`);
}

export interface QueryOptions {
  /** Crypto names and tickers count. Only true when a crypto rate can be had. */
  crypto?: boolean;
}

export function parseQuery(raw: string, baseCurrency?: string, options: QueryOptions = {}): ParsedQuery {
  const query = raw.trim();
  if (!query) return { price: null, targetCode: null, filter: '' };

  const tokens = query.split(/\s+/).filter(Boolean);
  const numbers = tokens.filter((token) => NUMERIC_TOKEN.test(token) && /\d/.test(token));
  const words = tokens.filter((token) => !NUMERIC_TOKEN.test(token));

  if (numbers.length && numbers.length + words.length === tokens.length && words.length <= 2) {
    const codes = words.map((word) => resolveCurrencyCode(word, options.crypto));

    if (words.length === 0 && baseCurrency) {
      // A bare number means "this many of my own currency", the most common
      // thing anyone types into a converter, and it used to filter the list to
      // nothing at all.
      const price = detectAmount(numbers, baseCurrency);
      if (price) return { price, targetCode: null, filter: '' };
    }

    if (codes.length && codes.every(Boolean)) {
      const [source, target] = codes as string[];
      const price = detectAmount(numbers, source);
      // "20 chf swiss" names the same currency twice, which is a source with no
      // destination rather than a conversion.
      if (price) return { price, targetCode: target && target !== source ? target : null, filter: '' };
    }
  }

  // Symbols are attached to their digits, so they never split into words.
  const direct = detectPriceFromText(query);
  if (direct) return { price: direct, targetCode: null, filter: '' };

  return { price: null, targetCode: null, filter: query.toLowerCase() };
}
