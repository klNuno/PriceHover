import { uiLocale } from './i18n';
import type { Rounding } from './settings';

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

function decimalsFor(amount: number, code: string, rounding: Rounding): number | null {
  // A price that is worth something must never print as zero. One VND is four
  // hundredths of a cent, and every rounding mode said "$0.00", which is not an
  // approximation of the answer but the opposite of it.
  const sunk = sunkDecimals(amount, code);
  if (sunk !== null) return sunk;

  if (rounding === 'integer') return 0;
  if (rounding === 'smart') return Math.min(naturalDecimals(code), smartDecimals(amount));
  return null;
}

/**
 * How many places it takes to show a non-zero amount that the currency's own
 * minor unit rounds away, or null when the minor unit already shows it.
 */
function sunkDecimals(amount: number, code: string): number | null {
  const magnitude = Math.abs(amount);
  if (magnitude === 0) return null;

  const natural = naturalDecimals(code);
  if (Math.round(magnitude * 10 ** natural) !== 0) return null;

  // One place past the first significant digit, and Intl caps fraction digits
  // at 20 whatever we ask for.
  return Math.min(20, Math.ceil(-Math.log10(magnitude)) + 1);
}

/** True when displaying `amount` at `decimals` places changes its value. */
function isApproximate(amount: number, decimals: number | null): boolean {
  if (decimals === null) return false;
  const factor = 10 ** decimals;
  return Math.abs(Math.round(amount * factor) / factor - amount) > 1e-9;
}

export function formatCurrencyAmount(
  amount: number,
  code: string,
  rounding: Rounding = 'exact'
): string {
  try {
    const decimals = decimalsFor(amount, code, rounding);
    const text = getFormatter(code, decimals).format(amount);
    // The tilde is the whole point of a rounding mode: it admits the number moved.
    return isApproximate(amount, decimals) ? `≈${text}` : text;
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
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
