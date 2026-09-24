import { describe, expect, test } from 'bun:test';
import {
  makeTokenResolver, pageChoice, regionFromHostname, regionFromLanguage, regionFromPage, rowChoice,
} from './locale';

describe('regionFromHostname', () => {
  test('reads a market ccTLD', () => {
    expect(regionFromHostname('www.amazon.ca')).toBe('CA');
    expect(regionFromHostname('komplett.no')).toBe('NO');
  });

  test('maps .uk to GB, the only ccTLD whose ISO code differs', () => {
    expect(regionFromHostname('amazon.co.uk')).toBe('GB');
  });

  test('ignores ccTLDs sold as vanity domains', () => {
    // .co is Colombia and .io is the Indian Ocean Territory, but neither says
    // anything about the currency on the page.
    for (const host of ['notion.so', 'bit.ly', 'vercel.app', 'x.co', 'fly.io', 'perplexity.ai']) {
      expect(regionFromHostname(host)).toBeNull();
    }
  });

  test('ignores generic TLDs', () => {
    expect(regionFromHostname('example.com')).toBeNull();
  });
});

describe('regionFromLanguage', () => {
  test('reads the region subtag', () => {
    expect(regionFromLanguage('en-CA')).toBe('CA');
    expect(regionFromLanguage('pt-BR')).toBe('BR');
    expect(regionFromLanguage('zh-Hans-CN')).toBe('CN');
  });

  test('a bare language has no region', () => {
    expect(regionFromLanguage('en')).toBeNull();
    expect(regionFromLanguage('')).toBeNull();
  });

  test('a script subtag is not a region', () => {
    expect(regionFromLanguage('zh-Hant')).toBeNull();
  });
});

describe('regionFromPage', () => {
  test('the domain wins over the lang attribute', () => {
    // A ccTLD is a deliberate choice of market; `lang` is boilerplate that gets
    // copied between deployments.
    expect(regionFromPage('amazon.ca', 'en-US')).toBe('CA');
  });

  test('the lang attribute is the fallback', () => {
    expect(regionFromPage('shop.example.com', 'en-NZ')).toBe('NZ');
  });
});

describe('makeTokenResolver', () => {
  test('returns null when the region changes nothing', () => {
    // France has no ambiguous token to resolve, so the detector should not even
    // pay for the indirection.
    expect(makeTokenResolver('fnac.fr', 'fr')).toBeNull();
    expect(makeTokenResolver('example.com', 'en')).toBeNull();
  });

  test('overrides only the tokens of that region', () => {
    const resolve = makeTokenResolver('amazon.ca', 'en')!;
    expect(resolve('$', 'USD')).toBe('CAD');
    expect(resolve('€', 'EUR')).toBe('EUR');
  });

  test('an unsupported currency leaves the default alone', () => {
    // Argentina is a market ccTLD but ARS is not in the currency table.
    const resolve = makeTokenResolver('mercadolibre.com.ar', 'es');
    expect(resolve?.('$', 'USD') ?? 'USD').toBe('USD');
  });
});

describe('makeTokenResolver layers', () => {
  test('the lock beats the domain', () => {
    const resolve = makeTokenResolver('amazon.ca', 'en', { locked: 'AUD' })!;
    expect(resolve('$', 'USD')).toBe('AUD');
    expect([...resolve.locked!]).toEqual(['$']);
  });

  test('the lock holds with page context switched off, and nothing else does', () => {
    expect(makeTokenResolver('amazon.ca', 'en', { usePage: false })).toBeNull();
    const resolve = makeTokenResolver('amazon.ca', 'en', { usePage: false, locked: 'NOK' })!;
    expect(resolve('$', 'USD')).toBe('USD');
    expect(resolve('kr', 'SEK')).toBe('NOK');
  });

  test('a lock on the default still marks the token as chosen', () => {
    // USD on amazon.ca: the domain says CAD, the user said otherwise.
    const resolve = makeTokenResolver('amazon.ca', 'en', { locked: 'USD' })!;
    expect(resolve('$', 'USD')).toBe('USD');
    expect(resolve.locked!.has('$')).toBe(true);
  });

  test('the row beats the domain', () => {
    const resolve = makeTokenResolver('steamdb.jp', 'ja', { context: { '¥': 'CNY' } })!;
    expect(resolve('¥', 'JPY')).toBe('CNY');
    expect(resolve('￥', 'JPY')).toBe('CNY');
  });

  test('the domain beats what was learned', () => {
    const resolve = makeTokenResolver('amazon.ca', 'en', { learned: { '$': 'AUD', kr: 'NOK' } })!;
    expect(resolve('$', 'USD')).toBe('CAD');
    expect(resolve('kr', 'SEK')).toBe('NOK');
  });

  test('what was learned applies where the site says nothing', () => {
    const resolve = makeTokenResolver('shop.example.com', 'en', { learned: { '$': 'CAD' } })!;
    expect(resolve('$', 'USD')).toBe('CAD');
    expect(resolve.locked!.size).toBe(0);
  });

  test('a lock outside the three families is ignored', () => {
    expect(makeTokenResolver('example.com', 'en', { locked: 'EUR' })).toBeNull();
  });
});

describe('rowChoice', () => {
  test('a row that names one currency by code', () => {
    expect(rowChoice('CNY Chinese Yuan Renminbi ¥ 69 -10%', new Set())).toEqual({ '¥': 'CNY' });
  });

  test('a row that names it in words', () => {
    expect(rowChoice('Chinese Yuan Renminbi ¥ 69', new Set())).toEqual({ '¥': 'CNY' });
    expect(rowChoice('Norwegian Krone 1 099 kr', new Set())).toEqual({ kr: 'NOK' });
    expect(rowChoice('日本円 ¥ 1,980', new Set())).toEqual({ '¥': 'JPY' });
  });

  test('two currencies of one family decide nothing', () => {
    expect(rowChoice('CAD or USD, $49', new Set())).toEqual({});
  });

  test('a currency the row already prints does not claim the bare token', () => {
    // SteamDB: `CDN$ 54.99` is the price, `$40.04` beside it is the US conversion.
    expect(rowChoice('Canadian Dollar CDN$ 54.99 $40.04', new Set(['CAD']))).toEqual({});
  });

  test('a code inside a word is not a mention', () => {
    expect(rowChoice('CADENCE $49', new Set())).toEqual({});
  });

  test('`元` alone is not a mention of the yuan', () => {
    expect(rowChoice('単元 ¥ 500', new Set())).toEqual({});
  });
});

describe('pageChoice', () => {
  const none = new Map<string, number>();

  test('a declared currency is enough on its own', () => {
    expect(pageChoice({ text: '', declared: ['CAD'], priced: none })).toEqual({ '$': 'CAD' });
  });

  test('a currency picker and a few written prices', () => {
    const text = 'Currency: CNY | Language: English';
    expect(pageChoice({ text, declared: [], priced: new Map([['CNY', 1]]) })).toEqual({ '¥': 'CNY' });
  });

  test('a single mention is not enough', () => {
    expect(pageChoice({ text: 'Ships from CAD', declared: [], priced: none })).toEqual({});
  });

  test('a page that lists many currencies decides nothing', () => {
    // SteamDB's price table: every currency, once or twice each.
    const text = 'USD CAD AUD NZD SGD HKD MXN CLP TWD BRL JPY CNY SEK NOK DKK';
    const priced = new Map([['CAD', 1], ['AUD', 1], ['NZD', 1], ['CNY', 1], ['JPY', 1]]);
    expect(pageChoice({ text, declared: [], priced })).toEqual({});
  });

  test('the winner has to lead by a wide margin', () => {
    const text = 'CAD CAD CAD USD';
    expect(pageChoice({ text, declared: [], priced: none })).toEqual({ '$': 'CAD' });
    expect(pageChoice({ text: 'CAD CAD CAD USD USD', declared: [], priced: none })).toEqual({});
  });

  test('currency names in prose count for nothing', () => {
    const text = 'The Canadian dollar rose against the Canadian dollar forecast. Canadian dollar!';
    expect(pageChoice({ text, declared: [], priced: none })).toEqual({});
  });

  test('a currency outside the families is ignored', () => {
    expect(pageChoice({ text: 'EUR EUR EUR', declared: ['EUR'], priced: none })).toEqual({});
  });
});
