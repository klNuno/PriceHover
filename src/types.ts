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
  matchedText?: string; // raw text matched by regex, used for display/debugging
  matchStart?: number; // offset in the analyzed text, used for hitbox positioning
  matchEnd?: number; // end offset (exclusive) in the analyzed text
  textSource?: 'full' | 'direct'; // which text extraction mode produced the match
}

export interface ConvertedPrice {
  currency: Currency;
  amount: number;
  formatted: string;
}

export const STORAGE = {
  RATES: 'rates',
  RATES_TS: 'ratesTimestamp',
  CURRENCIES: 'selectedCurrencies',
} as const;

export const DEFAULT_CURRENCIES = ['EUR', 'USD', 'GBP'];

export const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h
