import { CRYPTO_BY_CODE, type CryptoAsset } from './crypto';
import { uiLocale } from './i18n';
import type { Rounding } from './settings';

/** `Intl` puts one of these between a currency code and its number; so do we. */
const NBSP = ' ';

const FORMATTERS = new Map<string, Intl.NumberFormat>();

/**
 * `Intl` already knows each currency's minor unit from ISO 4217: 0 for JPY and
 * KRW, 3 for KWD. Overriding `maximumFractionDigits` by hand, as this used to,
 * only ever got that wrong: KWD was capped at two decimals.
 */
function getFormatter(code: string, decimals: number | null): Intl.NumberFormat {
  const key = `${code}:${decimals ?? 'auto'}`;
  let formatter = FORMATTERS.get(key);
  if (!formatter) {
    // A floor equal to the ceiling would print a rounded 9.99 as "$10.0", the
    // exact noise these modes exist to remove. A floor of zero would print
    // €0.50 as "€0.5". So: keep the floor only when nothing was cut.
    const natural = decimals === null ? decimals : naturalDecimals(code);
    formatter = new Intl.NumberFormat(uiLocale(), {
      style: 'currency',
      currency: code,
      ...(decimals === null
        ? {}
        : {
            minimumFractionDigits: decimals === natural ? decimals : 0,
            maximumFractionDigits: decimals,
          }),
    });
    FORMATTERS.set(key, formatter);
  }
  return formatter;
}

/** The currency's own minor unit, straight from ISO 4217 via `Intl`. */
function naturalDecimals(code: string): number {
  return getFormatter(code, null).resolvedOptions().maximumFractionDigits ?? 2;
}

/**
 * Digits that still carry information at this magnitude. A price converted at
 * yesterday's daily rate and printed as €1,234.56 claims a precision the rate
 * does not have; €1,235 is the same answer, honestly stated.
 */
function smartDecimals(amount: number): number {
  const magnitude = Math.abs(amount);
  if (magnitude >= 10) return 0;
  if (magnitude >= 1) return 1;
  return 2;
}

/**
 * Significant digits kept below one unit, whatever the rounding mode asked for.
 *
 * Two, because one is not an answer: a tenth of a yen is €0.00061, and rounding
 * it to the euro's own minor unit gives €0.01, sixteen times too much. The mode
 * chooses how coarse a *readable* price may be; it does not get to choose a
 * wrong one.
 */
const SIGNIFICANT_DIGITS = 2;

/**
 * The floor under which no amount is worth more digits. One satoshi is about
 * €0.00000014, so eight places still price the smallest unit anyone transacts
 * in, and anything below that is stated as a bound rather than padded with
 * zeroes nobody reads.
 */
const MAX_DECIMALS = 8;
const SMALLEST = 10 ** -MAX_DECIMALS;

/** Places needed for `digits` significant digits of a magnitude below one. */
function significantDecimals(magnitude: number, digits: number): number {
  return Math.max(0, Math.ceil(-Math.log10(magnitude)) - 1 + digits);
}

function decimalsFor(amount: number, natural: number, rounding: Rounding): number {
  const magnitude = Math.abs(amount);
  if (magnitude === 0) return natural;

  // `integer` keeps its promise while a whole number still says something. It
  // breaks it only where keeping it would print zero, which is not a rounder
  // version of the price but the opposite of it.
  if (rounding === 'integer') {
    return Math.round(magnitude) === 0
      ? Math.min(MAX_DECIMALS, significantDecimals(magnitude, 1))
      : 0;
  }

  const asked = rounding === 'smart' ? Math.min(natural, smartDecimals(amount)) : natural;
  const floor = magnitude < 1 ? significantDecimals(magnitude, SIGNIFICANT_DIGITS) : 0;
  return Math.min(MAX_DECIMALS, Math.max(asked, floor));
}

/**
 * True when a rounding mode actually gave up digits, which is what the tilde
 * announces. `exact` at the currency's own minor unit gave up nothing by
 * definition: $39.362 is $39.36, not approximately $39.36, and it printed
 * without a tilde in every version of this extension.
 */
function coarsened(rounding: Rounding, decimals: number, natural: number): boolean {
  return !(rounding === 'exact' && decimals === natural);
}

/** True when displaying `amount` at `decimals` places changes its value. */
function isApproximate(amount: number, decimals: number): boolean {
  const factor = 10 ** decimals;
  return Math.abs(Math.round(amount * factor) / factor - amount) > 1e-9;
}

export function formatCurrencyAmount(
  amount: number,
  code: string,
  rounding: Rounding = 'exact'
): string {
  const asset = CRYPTO_BY_CODE.get(code);
  if (asset) return formatCryptoAmount(amount, asset, rounding);

  try {
    const natural = naturalDecimals(code);
    const decimals = decimalsFor(amount, natural, rounding);
    if (amount > 0 && amount < SMALLEST / 2) {
      return `<${getFormatter(code, MAX_DECIMALS).format(SMALLEST)}`;
    }

    const text = getFormatter(code, decimals).format(amount);
    // The tilde is the whole point of a rounding mode: it admits the number moved.
    return coarsened(rounding, decimals, natural) && isApproximate(amount, decimals)
      ? `≈${text}`
      : text;
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

/**
 * Crypto never goes through `style: 'currency'`.
 *
 * `Intl` accepts a three-letter code it has never heard of and quietly formats
 * it with two decimals, so BTC printed as `BTC 0.00`; a four-letter one
 * (`DOGE`, `USDT`) throws `RangeError` outright and used to land in the
 * fallback above, as `0.00 DOGE`. Both are the same failure: a price that is
 * worth something displayed as nothing. A plain decimal formatter plus the
 * ticker has neither problem.
 */
function formatCryptoAmount(amount: number, asset: CryptoAsset, rounding: Rounding): string {
  const decimals = decimalsFor(amount, asset.decimals, rounding);
  if (amount > 0 && amount < SMALLEST / 2) {
    return `<${decimalText(SMALLEST, MAX_DECIMALS)}${NBSP}${asset.code}`;
  }

  const text = `${decimalText(amount, decimals)}${NBSP}${asset.code}`;
  return coarsened(rounding, decimals, asset.decimals) && isApproximate(amount, decimals)
    ? `≈${text}`
    : text;
}

/**
 * No minimum: a currency shows its minor unit in full (`€0.50`), a crypto
 * amount padded to its ceiling would read `0.00001560 BTC`, which is the same
 * number wearing four zeroes it did not earn.
 */
function decimalText(amount: number, decimals: number): string {
  const key = `decimal:${decimals}`;
  let formatter = FORMATTERS.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(uiLocale(), {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    });
    FORMATTERS.set(key, formatter);
  }
  return formatter.format(amount);
}

/**
 * A range prints with one currency marker: "$10 – 20" rather than "$10 – $20",
 * which reads as two unrelated prices in a tooltip 240 px wide.
 */
export function formatCurrencyRange(
  min: number,
  max: number,
  code: string,
  rounding: Rounding = 'exact'
): string {
  const low = formatCurrencyAmount(min, code, rounding);
  const high = formatCurrencyAmount(max, code, rounding);

  // Drop the leading run the two share (symbol, and `≈` when both carry it)
  // but never a digit, so "$1" and "$12" keep their first character.
  let shared = 0;
  while (
    shared < low.length &&
    shared < high.length &&
    low[shared] === high[shared] &&
    !/\d/.test(low[shared])
  ) {
    shared++;
  }
  return `${low} – ${high.slice(shared)}`;
}

/** Clears memoised formatters. Only useful if the UI language changes mid-session. */
export function resetFormatters(): void {
  FORMATTERS.clear();
}
