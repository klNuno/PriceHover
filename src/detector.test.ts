import { describe, expect, test } from 'bun:test';
import { detectAllFromText, detectPriceFromText, normalizeAmount } from './detector';
import { makeTokenResolver } from './locale';

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
    // The comma is still a thousands separator there: Kuwait writes 1,250.500.
    ['KD 1,250', 1250, 'KWD'],
    ['KWD 1,250.500', 1250.5, 'KWD'],
    // A qualifier one space from its sign used to fall back to a bare $.
    ['CA $30', 30, 'CAD'],
    ['C$30', 30, 'CAD'],
    ['AU$ 19.99', 19.99, 'AUD'],
    // U+2007 figure space groups an amount as surely as U+00A0 does.
    ['1 234,56 €', 1234.56, 'EUR'],
    // A single fraction digit only ever meant a version behind an ISO code.
    ['USD 12.5', 12.5, 'USD'],
    ['12.5 USD', 12.5, 'USD'],
    // Sub-unit prices: the trailing group of three is decimals, not thousands.
    ['$0.001', 0.001, 'USD'],
    ['€0,001', 0.001, 'EUR'],
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
    'Requires PHP 8',        // a version, not eight pesos
    'upgrade to PHP 5',
    'TRY 100 TIMES',         // an all-caps heading defeats case sensitivity alone
    'CRC32 checksum',        // an ISO code glued to digits is never a price
    'COP21 in Paris',
    'R2-D2 is a droid',      // one digit behind a one-character token
    'Model S/ 3',
    '-$5.00 discount',       // a negative line converts to the opposite claim
    '$99999999999999999999', // an id, not twenty digits of money
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

describe('price ranges', () => {
  const range = (text: string) => {
    const [price] = detectAllFromText(text);
    return price ? [price.amount, price.amountMax, price.currencyCode, text.slice(price.matchStart, price.matchEnd)] : null;
  };

  test('two full matches joined by a dash', () => {
    expect(range('€10 – €20')).toEqual([10, 20, 'EUR', '€10 – €20']);
  });

  test('a bare upper bound after a prefixed price', () => {
    expect(range('€10-20')).toEqual([10, 20, 'EUR', '€10-20']);
  });

  test('a bare lower bound before a suffixed price', () => {
    expect(range('10-20 kr')).toEqual([10, 20, 'SEK', '10-20 kr']);
  });

  test('a percentage is not an upper bound', () => {
    // "€10-20% off" is one price and a discount, not a range.
    expect(range('€10-20% off')).toEqual([10, undefined, 'EUR', '€10']);
  });

  test('a space before the percent sign does not make it one either', () => {
    expect(range('€10-20 % off')).toEqual([10, undefined, 'EUR', '€10']);
  });

  test('a merged range does not leave its upper bound behind as a price', () => {
    // "€10-20 USD" used to yield the range and then 20 USD, two hitboxes over
    // the same digits.
    expect(detectAllFromText('€10-20 USD').length).toBe(1);
  });

  test('a descending pair stays two prices', () => {
    expect(detectAllFromText('$5–$3').map((p) => p.amount)).toEqual([5, 3]);
  });

  test('prices separated by words stay separate', () => {
    expect(detectAllFromText('between $1,000 and $2,000').map((p) => p.amountMax)).toEqual([
      undefined,
      undefined,
    ]);
  });

  test('a bare year range is not a price', () => {
    expect(detectAllFromText('2020–2024 report')).toEqual([]);
  });
});

describe('page context resolves ambiguous tokens', () => {
  test('$ on a .ca domain is Canadian', () => {
    const [price] = detectAllFromText('$49.99', makeTokenResolver('amazon.ca', 'en')!);
    expect([price.currencyCode, price.inferred]).toEqual(['CAD', true]);
  });

  test('kr on a .no domain is Norwegian', () => {
    const [price] = detectAllFromText('1 099 kr', makeTokenResolver('komplett.no', 'nb')!);
    expect(price.currencyCode).toBe('NOK');
  });

  test('¥ on a .cn domain is yuan', () => {
    const [price] = detectAllFromText('¥ 3980', makeTokenResolver('jd.cn', 'zh')!);
    expect(price.currencyCode).toBe('CNY');
  });

  test('an explicit token is never overridden', () => {
    const [price] = detectAllFromText('US$ 20', makeTokenResolver('amazon.ca', 'en')!);
    expect([price.currencyCode, price.inferred]).toEqual(['USD', undefined]);
  });

  test('a lang region resolves when the domain is generic', () => {
    const [price] = detectAllFromText('$49.99', makeTokenResolver('shop.example.com', 'en-AU')!);
    expect(price.currencyCode).toBe('AUD');
  });

  test('no resolver leaves the historical default', () => {
    expect(detectAllFromText('$49.99')[0].currencyCode).toBe('USD');
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
    // Three-decimal currencies read a trailing group of three as decimals,
    // after a dot only: the comma stays a thousands separator there.
    ['1.234', 'KWD', 1.234],
    ['1.234', 'USD', 1234],
    ['1,250', 'KWD', 1250],
    ['1,250.500', 'KWD', 1250.5],
    // A lone zero cannot be a thousands group.
    ['0.001', 'USD', 0.001],
    ['0,001', 'EUR', 0.001],
  ];

  for (const [raw, code, expected] of cases) {
    test(`${raw} (${code})`, () => expect(normalizeAmount(raw, code)).toBeCloseTo(expected, 6));
  }

  test('a trailing decimal group is not left behind', () => {
    // The old heuristic stripped only the commas here and returned 1.234567.
    expect(normalizeAmount('1.234,567', 'EUR')).toBe(1234567);
  });
});
