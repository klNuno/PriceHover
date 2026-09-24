import { describe, expect, test } from 'bun:test';
import { parseQuery, resolveCurrencyCode } from './query';

describe('resolveCurrencyCode', () => {
  test('accepts codes in any case', () => {
    expect(resolveCurrencyCode('jpy')).toBe('JPY');
    expect(resolveCurrencyCode('  Eur ')).toBe('EUR');
  });

  test('accepts names and naive plurals', () => {
    expect(resolveCurrencyCode('yen')).toBe('JPY');
    expect(resolveCurrencyCode('franc')).toBe('CHF');
    expect(resolveCurrencyCode('francs')).toBe('CHF');
  });

  test('accepts informal names', () => {
    expect(resolveCurrencyCode('bucks')).toBe('USD');
    expect(resolveCurrencyCode('quid')).toBe('GBP');
    expect(resolveCurrencyCode('rmb')).toBe('CNY');
  });

  test('rejects the geographic words shared by many names', () => {
    // "south" belongs to South Korean Won and South African Rand alike.
    expect(resolveCurrencyCode('south')).toBeNull();
    expect(resolveCurrencyCode('united')).toBeNull();
  });
});

describe('parseQuery', () => {
  test('plain text filters the list', () => {
    const parsed = parseQuery('swiss');
    expect(parsed.price).toBeNull();
    expect(parsed.filter).toBe('swiss');
  });

  test('an amount and a currency converts, either order', () => {
    for (const query of ['20 chf', 'chf 20']) {
      const parsed = parseQuery(query);
      expect(parsed.price?.amount).toBe(20);
      expect(parsed.price?.currencyCode).toBe('CHF');
      expect(parsed.targetCode).toBeNull();
    }
  });

  test('a third token names the one destination', () => {
    const parsed = parseQuery('20 chf jpy');
    expect(parsed.price?.currencyCode).toBe('CHF');
    expect(parsed.targetCode).toBe('JPY');
  });

  test('the same currency twice is not a conversion', () => {
    expect(parseQuery('20 chf swiss').targetCode).toBeNull();
  });

  test('a bare number is an amount in the user’s own currency', () => {
    const parsed = parseQuery('2500', 'JPY');
    expect(parsed.price).toEqual(expect.objectContaining({ amount: 2500, currencyCode: 'JPY' }));
  });

  test('a bare number without a base currency stays a filter', () => {
    expect(parseQuery('2500').price).toBeNull();
  });

  test('a symbol query needs no words at all', () => {
    expect(parseQuery('$49.99').price?.currencyCode).toBe('USD');
  });

  test('grouped and quoted amounts parse', () => {
    expect(parseQuery('1 234,56 eur').price?.amount).toBe(1234.56);
    expect(parseQuery("1'200 chf").price?.amount).toBe(1200);
  });

  test('an empty query is neither', () => {
    expect(parseQuery('   ')).toEqual({ price: null, targetCode: null, filter: '' });
  });
});

describe('crypto in the calculator', () => {
  test('a ticker or a name is a source once crypto is on', () => {
    for (const query of ['0.5 btc', 'btc 0.5', '0.5 bitcoin']) {
      expect(parseQuery(query, 'EUR', { crypto: true }).price).toEqual({ amount: 0.5, currencyCode: 'BTC' });
    }
  });

  test('and a destination', () => {
    const parsed = parseQuery('100 eur eth', 'EUR', { crypto: true });
    expect([parsed.price?.currencyCode, parsed.targetCode]).toEqual(['EUR', 'ETH']);
    expect(parseQuery('100 eur ether', 'EUR', { crypto: true }).targetCode).toBe('ETH');
  });

  test('every asset, not only the nine a page is trusted with', () => {
    expect(parseQuery('12 avax usd', 'EUR', { crypto: true }).price?.currencyCode).toBe('AVAX');
    expect(parseQuery('3 solana', 'EUR', { crypto: true }).price?.currencyCode).toBe('SOL');
  });

  test('a long round amount is fine here, unlike on a page', () => {
    // On a page `ETH 8092` is Zurich. In the calculator it is what was typed.
    expect(parseQuery('8092 eth', 'EUR', { crypto: true }).price?.amount).toBe(8092);
  });

  test('crypto decimals survive', () => {
    expect(parseQuery('0.00012345 btc', 'EUR', { crypto: true }).price?.amount).toBe(0.00012345);
    expect(parseQuery('1.005 btc', 'EUR', { crypto: true }).price?.amount).toBe(1.005);
  });

  test('fiat keeps its words: sol is the Peruvian sol', () => {
    expect(resolveCurrencyCode('sol', true)).toBe('PEN');
  });

  test('off, a crypto word is just text to filter with', () => {
    const parsed = parseQuery('0.5 btc', 'EUR');
    expect(parsed.price).toBeNull();
    expect(resolveCurrencyCode('bitcoin')).toBeNull();
  });
});
