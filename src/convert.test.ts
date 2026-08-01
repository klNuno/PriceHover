import { describe, expect, test } from 'bun:test';
import { convertPrice } from './convert';
import type { DetectedPrice, ExchangeRates } from './types';

/** `Intl` separates a currency code from its number with a non-breaking space. */
const plain = (value: string): string => value.replace(/[  ]/g, ' ');

// One USD buys this many units, the shape both endpoints are normalised into.
const RATES: ExchangeRates = {
  USD: 1,
  EUR: 0.9,
  JPY: 160,
  BTC: 1 / 50000,
  DOGE: 5,
  SHIB: 200000,
};

const price = (amount: number, currencyCode: string): DetectedPrice => ({ amount, currencyCode });

describe('crypto is just another column in the rate table', () => {
  test('fiat converts into crypto', () => {
    const [row] = convertPrice(price(45, 'EUR'), RATES, ['BTC']);
    expect(row.currency.code).toBe('BTC');
    expect(row.amount).toBeCloseTo(0.001, 9);
    expect(plain(row.formatted)).toBe('0.001 BTC');
  });

  test('crypto converts into fiat', () => {
    const [row] = convertPrice(price(0.05, 'BTC'), RATES, ['EUR']);
    expect(row.amount).toBeCloseTo(2250, 6);
    expect(row.formatted).toBe('€2,250.00');
  });

  test('a price worth a fraction of a cent still says so', () => {
    // 1 SHIB is five millionths of a dollar. Every mode used to print €0.00.
    const [row] = convertPrice(price(1, 'SHIB'), RATES, ['EUR'], 'smart');
    expect(row.formatted).toBe('€0.0000045');
  });

  test('a range keeps both bounds in the target asset', () => {
    const [row] = convertPrice(
      { amount: 45, currencyCode: 'EUR', amountMax: 90 }, RATES, ['BTC']
    );
    expect(plain(row.formatted)).toBe('0.001 BTC');
    expect(plain(row.formattedMax ?? '')).toBe('0.002 BTC');
  });

  test('a target with no rate is skipped rather than shown empty', () => {
    // Exactly what a revoked permission leaves behind: the code is still in the
    // user's list, the rate is gone.
    expect(convertPrice(price(45, 'EUR'), RATES, ['XMR'])).toEqual([]);
  });

  test('the order asked for is the order returned', () => {
    const rows = convertPrice(price(45, 'EUR'), RATES, ['USD', 'BTC', 'DOGE']);
    expect(rows.map((r) => r.currency.code)).toEqual(['USD', 'BTC', 'DOGE']);
  });
});
