import { CURRENCY_BY_CODE } from './currencies';
import { formatCurrencyAmount } from './formatter';
import type { Rounding } from './settings';
import type { ConvertedPrice, DetectedPrice, ExchangeRates } from './types';

function usableRate(rates: ExchangeRates, code: string): number | null {
  const rate = rates[code];
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * Converts one detected price into every requested currency, keeping the order
 * it was given — the caller puts the user's own currency first, and the tooltip
 * relies on that to know which row to emphasise.
 */
export function convertPrice(
  detected: DetectedPrice,
  rates: ExchangeRates,
  targetCodes: readonly string[],
  rounding: Rounding = 'exact'
): ConvertedPrice[] {
  const sourceRate = usableRate(rates, detected.currencyCode);
  if (sourceRate === null) return [];

  const out: ConvertedPrice[] = [];
  for (const code of targetCodes) {
    if (code === detected.currencyCode) continue;

    const targetRate = usableRate(rates, code);
    const currency = CURRENCY_BY_CODE.get(code);
    if (targetRate === null || !currency) continue;

    const factor = targetRate / sourceRate;
    const amount = detected.amount * factor;

    out.push({
      currency,
      amount,
      formatted: formatCurrencyAmount(amount, code, rounding),
      ...(detected.amountMax === undefined
        ? {}
        : { formattedMax: formatCurrencyAmount(detected.amountMax * factor, code, rounding) }),
    });
  }
  return out;
}
