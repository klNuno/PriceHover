import { describe, expect, test } from 'bun:test';
import { formatCurrencyAmount, formatCurrencyRange } from './formatter';

/** `Intl` separates a currency code from its number with a non-breaking space. */
const plain = (value: string): string => value.replace(/[  ]/g, ' ');

describe('exact rounding follows the currency, not a hardcoded 2', () => {
  test('JPY has no minor unit', () => {
    expect(formatCurrencyAmount(1235, 'JPY', 'exact')).toBe('¥1,235');
  });

  test('KWD has three decimals', () => {
    // The old formatter capped every currency but JPY and KRW at two, which
    // silently truncated every dinar amount.
    expect(plain(formatCurrencyAmount(12.5, 'KWD', 'exact'))).toBe('KWD 12.500');
  });

  test('USD keeps its two', () => {
    expect(formatCurrencyAmount(39.362, 'USD', 'exact')).toBe('$39.36');
  });
});

describe('an amount worth something never prints as zero', () => {
  // One VND converts to four hundredths of a cent, and every mode used to say
  // "$0.00", which reads as free rather than as very little.
  const cases: [number, string, string][] = [
    [0.00004, 'USD', '$0.00004'],
    [0.00004, 'EUR', '€0.00004'],
    [0.004, 'USD', '$0.004'],
  ];

  for (const [amount, code, expected] of cases) {
    test(`${amount} ${code}`, () => {
      expect(plain(formatCurrencyAmount(amount, code, 'exact'))).toBe(expected);
      expect(plain(formatCurrencyAmount(amount, code, 'smart'))).toBe(expected);
      expect(plain(formatCurrencyAmount(amount, code, 'integer'))).toBe(expected);
    });
  }

  test('zero itself is untouched', () => {
    expect(formatCurrencyAmount(0, 'USD', 'exact')).toBe('$0.00');
  });
});

describe('an amount below the minor unit keeps two significant digits', () => {
  // The old rule only rescued an amount that rounded to *exactly* zero, so a
  // tenth of a yen printed as €0.00061 while a whole yen printed as €0.01,
  // sixty-four percent too much. The band between the cliff and one cent was
  // where every per-unit and prorated price landed.
  const cases: [number, string, string, string][] = [
    [0.0061, 'EUR', '€0.0061', '≈€0.006'],
    [0.0183, 'EUR', '≈€0.018', '≈€0.02'],
    [0.061, 'EUR', '€0.061', '≈€0.06'],
    [0.0061, 'USD', '$0.0061', '≈$0.006'],
    [0.056, 'INR', '₹0.056', '≈₹0.06'],
  ];

  for (const [amount, code, expected, whole] of cases) {
    test(`${amount} ${code}`, () => {
      expect(plain(formatCurrencyAmount(amount, code, 'exact'))).toBe(expected);
      expect(plain(formatCurrencyAmount(amount, code, 'smart'))).toBe(expected);
      // `integer` gives up a digit, never the whole number.
      expect(plain(formatCurrencyAmount(amount, code, 'integer'))).toBe(whole);
    });
  }

  test('a power of ten still shows the minor unit in full', () => {
    expect(formatCurrencyAmount(0.1, 'EUR', 'exact')).toBe('€0.10');
    expect(formatCurrencyAmount(0.01, 'EUR', 'exact')).toBe('€0.01');
  });

  test('integer keeps whole numbers whole where they say something', () => {
    expect(formatCurrencyAmount(0.873, 'GBP', 'integer')).toBe('≈£1');
    expect(formatCurrencyAmount(0.5, 'EUR', 'integer')).toBe('≈€1');
  });

  test('a three-decimal currency is not flattened by the floor', () => {
    expect(plain(formatCurrencyAmount(0.0004, 'KWD', 'exact'))).toBe('KWD 0.0004');
  });
});

describe('the smallest amount worth printing', () => {
  test('one satoshi in euros still fits', () => {
    expect(formatCurrencyAmount(1.4e-7, 'EUR', 'exact')).toBe('€0.00000014');
  });

  test('below that, a bound rather than a wall of zeroes', () => {
    // One SHIB is about four billionths of a euro. Eight places is already the
    // point where the answer stops being a price.
    for (const rounding of ['exact', 'smart', 'integer'] as const) {
      expect(formatCurrencyAmount(4.3e-9, 'EUR', rounding)).toBe('<€0.00000001');
    }
  });

  test('zero is not a bound', () => {
    expect(formatCurrencyAmount(0, 'USD', 'exact')).toBe('$0.00');
  });
});

describe('crypto never goes through Intl currency formatting', () => {
  test('a four-letter ticker would throw, and used to print as zero', () => {
    // `new Intl.NumberFormat(l, {currency: 'DOGE'})` is a RangeError, which
    // landed in the unknown-code fallback as "0.00 DOGE".
    expect(plain(formatCurrencyAmount(0.0004821, 'DOGE', 'exact'))).toBe('≈0.00048 DOGE');
    expect(plain(formatCurrencyAmount(12.5, 'USDT', 'exact'))).toBe('12.5 USDT');
  });

  test('a three-letter ticker is not two decimals either', () => {
    // Intl accepts BTC and formats it like a currency with a minor unit, so
    // this amount printed as "BTC 0.00".
    expect(plain(formatCurrencyAmount(0.0000156, 'BTC', 'exact'))).toBe('0.0000156 BTC');
  });

  test('the ceiling is not a minimum', () => {
    expect(plain(formatCurrencyAmount(1, 'BTC', 'exact'))).toBe('1 BTC');
    expect(plain(formatCurrencyAmount(0.5, 'ETH', 'exact'))).toBe('0.5 ETH');
  });

  test('an asset priced in millionths still reads as a whole number', () => {
    expect(plain(formatCurrencyAmount(10_500_000, 'SHIB', 'exact'))).toBe('10,500,000 SHIB');
  });

  test('the floor applies to crypto too', () => {
    expect(plain(formatCurrencyAmount(0.0000000043, 'BTC', 'exact'))).toBe('<0.00000001 BTC');
  });
});

describe('smart rounding', () => {
  test('drops decimals as the amount grows', () => {
    expect(formatCurrencyAmount(1234.567, 'EUR', 'smart')).toBe('≈€1,235');
    expect(formatCurrencyAmount(39.362, 'USD', 'smart')).toBe('≈$39');
  });

  test('keeps them where they still matter', () => {
    expect(formatCurrencyAmount(0.873, 'GBP', 'smart')).toBe('≈£0.87');
  });

  test('never invents a trailing zero', () => {
    // 9.99 rounds to 10 at one decimal; "$10.0" would be the noise this mode
    // exists to remove.
    expect(formatCurrencyAmount(9.99, 'USD', 'smart')).toBe('≈$10');
  });

  test('keeps the natural minimum when nothing was cut', () => {
    expect(formatCurrencyAmount(0.5, 'EUR', 'smart')).toBe('€0.50');
  });

  test('no tilde when the number did not move', () => {
    expect(formatCurrencyAmount(10, 'USD', 'smart')).toBe('$10');
    expect(formatCurrencyAmount(1235, 'JPY', 'smart')).toBe('¥1,235');
  });
});

describe('integer rounding', () => {
  test('always whole', () => {
    expect(formatCurrencyAmount(0.873, 'GBP', 'integer')).toBe('≈£1');
    expect(formatCurrencyAmount(1234.567, 'EUR', 'integer')).toBe('≈€1,235');
  });
});

describe('formatCurrencyRange', () => {
  test('the currency marker is not repeated', () => {
    expect(formatCurrencyRange(10, 20, 'EUR', 'smart')).toBe('€10 – 20');
  });

  test('an approximation marker is shared too', () => {
    expect(formatCurrencyRange(10.4, 20.6, 'USD', 'smart')).toBe('≈$10 – 21');
  });

  test('a digit is never treated as a shared prefix', () => {
    expect(formatCurrencyRange(1, 12, 'USD', 'integer')).toBe('$1 – 12');
  });
});

describe('unknown currency codes', () => {
  test('fall back rather than throw', () => {
    expect(formatCurrencyAmount(12.3, 'NOTACODE')).toBe('12.30 NOTACODE');
  });
});
