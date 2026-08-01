import { describe, expect, test } from 'bun:test';
import { cryptoRatesUrl, parseCryptoRates, parseCryptoTable, parseRates } from './rates';

describe('parseRates', () => {
  test('keeps positive finite rates', () => {
    expect(parseRates({ USD: 1, EUR: 0.92, JPY: 157.3 })).toEqual({
      USD: 1,
      EUR: 0.92,
      JPY: 157.3,
    });
  });

  test('drops entries that are not usable numbers', () => {
    const rates = parseRates({
      USD: 1,
      EUR: 'nope',
      GBP: 0,
      JPY: -3,
      CHF: null,
      SEK: Number.NaN,
      NOK: Number.POSITIVE_INFINITY,
      CAD: 1.36,
    });
    expect(rates).toEqual({ USD: 1, CAD: 1.36 });
  });

  test('rejects a payload with no USD anchor', () => {
    expect(parseRates({ EUR: 0.92 })).toBeNull();
  });

  const rejected: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['a string', '{"USD":1}'],
    ['a number', 42],
    ['an array', [1, 2, 3]],
  ];

  for (const [label, value] of rejected) {
    test(`rejects ${label}`, () => expect(parseRates(value)).toBeNull());
  }
});

describe('parseCryptoRates', () => {
  test('inverts a price into the same USD-anchored table the fiat half speaks', () => {
    // One USD buys this many units, which is what `convert.ts` already reads.
    const rates = parseCryptoRates({ bitcoin: { usd: 50000 }, ethereum: { usd: 2000 } });
    expect(rates).toEqual({ BTC: 1 / 50000, ETH: 1 / 2000 });
  });

  test('a price of zero is dropped, not inverted into infinity', () => {
    // The endpoint rounds without `precision=full`, and an asset priced in
    // millionths came back as 0. A rate of Infinity shows as a price.
    expect(parseCryptoRates({ bitcoin: { usd: 50000 }, 'shiba-inu': { usd: 0 } }))
      .toEqual({ BTC: 1 / 50000 });
  });

  test('drops anything that is not a usable price', () => {
    const rates = parseCryptoRates({
      bitcoin: { usd: 50000 },
      ethereum: { usd: '2000' },
      monero: { usd: -1 },
      dogecoin: { usd: Number.NaN },
      tether: {},
      'usd-coin': null,
    });
    expect(rates).toEqual({ BTC: 1 / 50000 });
  });

  test('an id we never asked for is not a rate', () => {
    expect(parseCryptoRates({ 'some-new-coin': { usd: 3 } })).toBeNull();
  });

  const rejected: [string, unknown][] = [
    ['null', null],
    ['a string', '{"bitcoin":{"usd":1}}'],
    ['an array', [{ usd: 1 }]],
    ['an empty payload', {}],
  ];

  for (const [label, value] of rejected) {
    test(`rejects ${label}`, () => expect(parseCryptoRates(value)).toBeNull());
  }

  test('the request names every asset and asks for full precision', () => {
    const url = cryptoRatesUrl();
    expect(url).toContain('ids=bitcoin,ethereum,monero');
    expect(url).toContain('precision=full');
    expect(url).toContain('vs_currencies=usd');
  });
});

describe('parseCryptoTable', () => {
  test('reads back what was stored', () => {
    expect(parseCryptoTable({ BTC: 0.00002, XMR: 0.0028 })).toEqual({ BTC: 0.00002, XMR: 0.0028 });
  });

  test('a fiat code in the crypto half is dropped', () => {
    // The merged table lets crypto win a collision, so a stray EUR here would
    // silently replace the real euro rate for the whole session.
    expect(parseCryptoTable({ BTC: 0.00002, EUR: 5 })).toEqual({ BTC: 0.00002 });
  });

  test('no USD anchor is required, unlike the fiat table', () => {
    expect(parseCryptoTable({ BTC: 0.00002 })).not.toBeNull();
  });

  test('nothing usable is null rather than an empty table', () => {
    expect(parseCryptoTable({ EUR: 5 })).toBeNull();
  });
});
