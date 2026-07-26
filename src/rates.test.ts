import { describe, expect, test } from 'bun:test';
import { parseRates } from './rates';

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
