import { describe, expect, test } from 'bun:test';
import { MAX_SITE_HINTS, parseSiteHints, withSiteHint } from './site-hints';

describe('parseSiteHints', () => {
  test('keeps a code only under the family it belongs to', () => {
    const raw = { 'WWW.Shop.com': { c: { '$': 'CAD', kr: 'CAD', '¥': 'EUR' }, t: 5 } };
    expect(parseSiteHints(raw)).toEqual({ 'shop.com': { c: { '$': 'CAD' }, t: 5 } });
  });

  test('an entry with nothing usable is dropped', () => {
    expect(parseSiteHints({ 'a.com': { c: { '$': 'EUR' } }, 'b.com': 3, 'c.com': null })).toEqual({});
  });

  test('anything but an object is empty', () => {
    for (const raw of [undefined, null, 'x', ['a.com'], 7]) expect(parseSiteHints(raw)).toEqual({});
  });
});

describe('withSiteHint', () => {
  test('a new site is added', () => {
    expect(withSiteHint({}, 'shop.com', { '$': 'CAD' }, 10)).toEqual({ 'shop.com': { c: { '$': 'CAD' }, t: 10 } });
  });

  test('a family the page did not speak about keeps its earlier answer', () => {
    const hints = { 'shop.com': { c: { kr: 'NOK' }, t: 1 } };
    expect(withSiteHint(hints, 'shop.com', { '$': 'CAD' }, 2)!['shop.com'].c).toEqual({ '$': 'CAD', kr: 'NOK' });
  });

  test('a newer answer replaces an older one', () => {
    const hints = { 'shop.com': { c: { '$': 'AUD' }, t: 1 } };
    expect(withSiteHint(hints, 'shop.com', { '$': 'CAD' }, 2)!['shop.com'].c).toEqual({ '$': 'CAD' });
  });

  test('saying the same thing again writes nothing', () => {
    const hints = { 'shop.com': { c: { '$': 'CAD' }, t: 1 } };
    expect(withSiteHint(hints, 'www.shop.com', { '$': 'CAD' }, 2)).toBeNull();
    expect(withSiteHint(hints, 'shop.com', {}, 2)).toBeNull();
  });

  test('the oldest sites go first past the cap', () => {
    const hints = Object.fromEntries(
      Array.from({ length: MAX_SITE_HINTS }, (_, i) => [`s${i}.com`, { c: { '$': 'CAD' }, t: i + 1 }])
    );
    const next = withSiteHint(hints, 'new.com', { '$': 'AUD' }, 10_000)!;
    expect(Object.keys(next)).toHaveLength(MAX_SITE_HINTS);
    expect(next['s0.com']).toBeUndefined();
    expect(next['new.com'].c).toEqual({ '$': 'AUD' });
  });

  test('an inherited key is not a site', () => {
    expect(withSiteHint({}, 'constructor', { '$': 'CAD' }, 1)).toEqual({ constructor: { c: { '$': 'CAD' }, t: 1 } });
  });
});
