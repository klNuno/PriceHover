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
  /**
   * Crypto lives under its own keys, and not because it is a different kind of
   * money: it is a different host on a different clock. One shared timestamp
   * would let a fiat refresh vouch for the freshness of a crypto rate it never
   * fetched, which is exactly the lie the staleness warning exists to prevent.
   */
  CRYPTO_RATES: 'cryptoRates',
  CRYPTO_TS: 'cryptoRatesTimestamp',
  /** Pre-1.4.0 flat currency list. Read once, for migration. */
  CURRENCIES: 'selectedCurrencies',
  SETTINGS: 'settings',
} as const;

export const DEFAULT_CURRENCIES = ['EUR', 'USD', 'GBP'];

export const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Crypto on its own clock. A daily rate is fine for EUR/USD, which moves a
 * fraction of a percent in a day, and indefensible for BTC, which can move five
 * percent while a tab is open.
 *
 * An hour rather than a minute, and the reason is not bandwidth: the payload is
 * about a kilobyte. Every request tells a second host that this browser is
 * awake, and that count is the whole privacy cost of the feature. Refreshes are
 * demand-driven, so a session that never shows a crypto row makes none at all.
 */
export const CRYPTO_CACHE_MS = 60 * 60 * 1000; // 1h

/**
 * Past this, the UI says the rates might be wrong rather than quietly showing
 * them. Deliberately longer than the refresh interval: one missed refresh is a
 * flaky network, several days of them is the API being down.
 */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000; // 48h

/** Same idea, same ratio: several missed hourly refreshes, not one. */
export const CRYPTO_STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6h
