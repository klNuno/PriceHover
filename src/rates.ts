import type { ExchangeRates } from './types';

export const RATES_URL = 'https://open.er-api.com/v6/latest/USD';

/**
 * Keeps only the entries that are usable as a rate. Anything the endpoint sends
 * that is not a positive finite number is dropped rather than trusted, because
 * a single NaN would surface as a nonsense converted price.
 *
 * Returns null when the payload has no USD rate, since every conversion is
 * relative to it.
 */
export function parseRates(value: unknown): ExchangeRates | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const rates: ExchangeRates = {};
  for (const [code, rate] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) rates[code] = rate;
  }

  return rates.USD ? rates : null;
}

/**
 * How long to wait before giving up. A connection that hangs used to keep an
 * MV3 service worker alive until Chrome's five-minute cap killed it with the
 * rates unwritten and the caller still awaiting.
 */
const FETCH_TIMEOUT_MS = 10_000;

/** Throws on a network, timeout or HTTP failure; returns null on a bad payload. */
export async function fetchRates(): Promise<ExchangeRates | null> {
  const res = await fetch(RATES_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data: unknown = await res.json();
  return parseRates((data as { rates?: unknown } | null)?.rates);
}
