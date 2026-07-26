export interface Currency {
  code: string;
  symbol: string;
  flag: string;
  name: string;
}

export interface ExchangeRates {
  [currencyCode: string]: number;
}

export interface StoredRates {
  rates: ExchangeRates;
  ratesTimestamp: number;
}

export interface DetectedPrice {
  amount: number;
  currencyCode: string;
  /** Upper bound when the match was a range ("€10–€20"). */
  amountMax?: number;
  matchedText?: string; // raw text matched by regex, used for display/debugging
  matchStart?: number; // offset in the analyzed text, used for hitbox positioning
  matchEnd?: number; // end offset (exclusive) in the analyzed text
  textSource?: 'full' | 'direct'; // which text extraction mode produced the match
  /** True when the currency was inferred from the page, not written in the text. */
  inferred?: boolean;
}

export interface ConvertedPrice {
  currency: Currency;
  amount: number;
  formatted: string;
  /** Present only when the source was a range. */
  formattedMax?: string;
}

export const STORAGE = {
  RATES: 'rates',
  RATES_TS: 'ratesTimestamp',
  /** Pre-1.4.0 flat currency list. Read once, for migration. */
  CURRENCIES: 'selectedCurrencies',
  SETTINGS: 'settings',
} as const;

export const DEFAULT_CURRENCIES = ['EUR', 'USD', 'GBP'];

export const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Past this, the UI says the rates might be wrong rather than quietly showing
 * them. Deliberately longer than the refresh interval: one missed refresh is a
 * flaky network, several days of them is the API being down.
 */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000; // 48h
