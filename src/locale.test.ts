import { describe, expect, test } from 'bun:test';
import { makeTokenResolver, regionFromHostname, regionFromLanguage, regionFromPage } from './locale';

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
