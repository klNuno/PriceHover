import { describe, expect, test } from 'bun:test';
import { detectAllFromText, detectPriceFromText, normalizeAmount } from './detector';

/** Compact helper: the first price found in `text`, or null. */
function detect(text: string) {
  const price = detectPriceFromText(text);
  return price ? { amount: price.amount, code: price.currencyCode } : null;
}

describe('detects real prices', () => {
  const cases: [string, number, string][] = [
    ['$19.99', 19.99, 'USD'],
    ['€12,50', 12.5, 'EUR'],
    ['£1,234.56', 1234.56, 'GBP'],
    ['¥1980', 1980, 'JPY'],
    ['1.234,56 €', 1234.56, 'EUR'],
    ['1 234,56 €', 1234.56, 'EUR'],
    ['199 kr', 199, 'SEK'],
    ['R$ 49,90', 49.9, 'BRL'],
    ['RM 5', 5, 'MYR'],
    ['Rp 746000', 746000, 'IDR'],
    ['₫ 1.500.000', 1500000, 'VND'],
    ['USD 42', 42, 'USD'],
    ['42 USD', 42, 'USD'],
    ['CA$ 30', 30, 'CAD'],
    ['S/. 120', 120, 'PEN'],
    ['R199', 199, 'ZAR'],
    ['zł 89,99', 89.99, 'PLN'],
    ['249 Kč', 249, 'CZK'],
    ['3 990 Ft', 3990, 'HUF'],
    ['Fr. 89.90', 89.9, 'CHF'],
    ['199 kr.', 199, 'SEK'],
    // Indian lakh grouping: two-digit groups above the first thousand.
    ['₹1,49,900', 149900, 'INR'],
    ['₹12,34,567.89', 1234567.89, 'INR'],
    // KWD has three decimals, so a trailing group of three is not thousands.
    ['KD 12.500', 12.5, 'KWD'],
  ];

  for (const [text, amount, code] of cases) {
    test(text, () => expect(detect(text)).toEqual({ amount, code }));
  }
});

describe('rejects prose that looks like a price', () => {
  const cases = [
    'Chapter r 10',          // bare lowercase r is not ZAR
    'see section R 5',       // a spaced bare R is not ZAR either
    'Version 5 RM',          // RM only reads as ringgit in front of the amount
    'error code 500 KD',
    'Model X 200 SR',
    'try 100 times',         // lowercase ISO codes are not currencies
    'requires php 8.2',
    'Requires PHP 8.2',      // one fraction digit after a word token
    'Q4 2024 revenue',
    'RAM 16 GB',
    'covid 19',
    'weight 250 g',
    'EURO 20',               // trailing letter breaks the token
    '€1234.5678',            // rather nothing than a truncated €1234.56
    '$0',                    // zero is not a price
  ];

  for (const text of cases) {
    test(text, () => expect(detect(text)).toBeNull());
  }
});

describe('does not salvage a partial amount', () => {
  test('1.2345 USD yields nothing', () => {
    expect(detect('1.2345 USD')).toBeNull();
  });

  test('a price inside a longer number is ignored', () => {
    expect(detect('order 12345678')).toBeNull();
  });
});

describe('finds every price in a run of text', () => {
  test('two prices', () => {
    const found = detectAllFromText('Was $49.99, now $29.99');
    expect(found.map((p) => p.amount)).toEqual([49.99, 29.99]);
  });

  test('mixed currencies keep their own code', () => {
    const found = detectAllFromText('€10 / $12 / £9');
    expect(found.map((p) => p.currencyCode)).toEqual(['EUR', 'USD', 'GBP']);
  });

  test('offsets point back at the matched text', () => {
    const text = 'total: $19.99 incl. tax';
    const [price] = detectAllFromText(text);
    expect(text.slice(price.matchStart, price.matchEnd)).toBe(price.matchedText ?? '');
  });

  test('a price never spans a line break', () => {
    expect(detectAllFromText('$\n19.99')).toEqual([]);
  });
});

describe('normalizeAmount', () => {
  const cases: [string, string, number][] = [
    ['1,234.56', 'USD', 1234.56],
    ['1.234,56', 'EUR', 1234.56],
    ['1 234,56', 'EUR', 1234.56],
    ['3,500', 'USD', 3500],
    ['3.500', 'EUR', 3500],
    ['12,99', 'EUR', 12.99],
    ['12.99', 'USD', 12.99],
    ['1.234.567', 'EUR', 1234567],
    ['1,234,567', 'USD', 1234567],
    ['746000', 'IDR', 746000],
    // Three-decimal currencies read a trailing group of three as decimals.
    ['1.234', 'KWD', 1.234],
    ['1.234', 'USD', 1234],
  ];

  for (const [raw, code, expected] of cases) {
    test(`${raw} (${code})`, () => expect(normalizeAmount(raw, code)).toBeCloseTo(expected, 6));
  }

  test('a trailing decimal group is not left behind', () => {
    // The old heuristic stripped only the commas here and returned 1.234567.
    expect(normalizeAmount('1.234,567', 'EUR')).toBe(1234567);
  });
});
