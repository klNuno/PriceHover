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
