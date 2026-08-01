import { CRYPTO_ASSETS, cryptoIds, isCryptoCode } from './crypto';
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
function usableRates(value: unknown): ExchangeRates | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const rates: ExchangeRates = {};
  for (const [code, rate] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) rates[code] = rate;
  }
  return rates;
}

export function parseRates(value: unknown): ExchangeRates | null {
  const rates = usableRates(value);
  return rates?.USD ? rates : null;
}

/**
 * A stored crypto table, read back with the same suspicion as the wire.
 *
 * Two differences from the fiat one. There is no USD anchor to check: the fiat
 * table owns USD and the crypto table is written against it. And the codes are
 * restricted to the assets we know, because the merged table lets crypto win
 * on a key collision, so a stray `EUR` in this half would quietly replace the
 * real euro rate.
 */
export function parseCryptoTable(value: unknown): ExchangeRates | null {
  const rates = usableRates(value);
  if (!rates) return null;

  const known: ExchangeRates = {};
  for (const [code, rate] of Object.entries(rates)) {
    if (isCryptoCode(code)) known[code] = rate;
  }
  return Object.keys(known).length ? known : null;
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

/**
 * The second host, and the only one that is optional. No key: an API key
 * shipped inside an extension is public by definition, which rules out most of
 * the alternatives on its own.
 *
 * `precision=full` matters. Without it the endpoint rounds, and an asset priced
 * in millionths of a dollar comes back as 0, which is a rate of infinity.
 */
export const CRYPTO_ORIGIN = 'https://api.coingecko.com/';
export const CRYPTO_ORIGIN_PATTERN = 'https://api.coingecko.com/*';

export function cryptoRatesUrl(): string {
  return `${CRYPTO_ORIGIN}api/v3/simple/price?ids=${cryptoIds()}&vs_currencies=usd&precision=full`;
}

/**
 * Turns `{ bitcoin: { usd: 63902.2 } }` into the same USD-anchored table the
 * fiat endpoint already speaks: one USD buys this many units. Every other
 * module then reads one table and never learns there were two sources.
 *
 * A price of zero, a negative, a string, a missing asset: dropped rather than
 * inverted into Infinity and shown as a price.
 */
export function parseCryptoRates(value: unknown): ExchangeRates | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const prices = value as Record<string, unknown>;
  const rates: ExchangeRates = {};
  for (const asset of CRYPTO_ASSETS) {
    const price = (prices[asset.id] as { usd?: unknown } | undefined)?.usd;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue;

    const rate = 1 / price;
    if (Number.isFinite(rate) && rate > 0) rates[asset.code] = rate;
  }

  return Object.keys(rates).length ? rates : null;
}

/** Throws on a network, timeout or HTTP failure; returns null on a bad payload. */
export async function fetchCryptoRates(): Promise<ExchangeRates | null> {
  const res = await fetch(cryptoRatesUrl(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  return parseCryptoRates(await res.json());
}
