import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SETTINGS, displayCurrencies, isActiveOn, isSiteDisabled, migrateLegacy,
  normalizeHostname, parseSettings,
} from './settings';

describe('parseSettings', () => {
  test('anything unusable falls back to the defaults', () => {
    for (const input of [null, undefined, 42, 'nope', []]) {
      expect(parseSettings(input)).toEqual(DEFAULT_SETTINGS);
    }
  });

  test('unknown currency codes are dropped, not kept', () => {
    const settings = parseSettings({ baseCurrency: 'XXX', targetCurrencies: ['USD', 'FAKE', 'GBP'] });
    expect(settings.baseCurrency).toBe(DEFAULT_SETTINGS.baseCurrency);
    expect(settings.targetCurrencies).toEqual(['USD', 'GBP']);
  });

  test('the base currency never appears among the targets', () => {
    // It would otherwise show up twice in the tooltip.
    const settings = parseSettings({ baseCurrency: 'USD', targetCurrencies: ['USD', 'EUR'] });
    expect(settings.targetCurrencies).toEqual(['EUR']);
  });

  test('duplicate targets collapse', () => {
    expect(parseSettings({ targetCurrencies: ['USD', 'USD', 'GBP'] }).targetCurrencies)
      .toEqual(['USD', 'GBP']);
  });

  test('the hover delay is clamped, not trusted', () => {
    expect(parseSettings({ hoverDelayMs: -50 }).hoverDelayMs).toBe(0);
    expect(parseSettings({ hoverDelayMs: 99_999 }).hoverDelayMs).toBe(2000);
    expect(parseSettings({ hoverDelayMs: 'soon' }).hoverDelayMs).toBe(DEFAULT_SETTINGS.hoverDelayMs);
  });

  test('an unknown rounding mode falls back', () => {
    expect(parseSettings({ rounding: 'wild' }).rounding).toBe(DEFAULT_SETTINGS.rounding);
    expect(parseSettings({ rounding: 'integer' }).rounding).toBe('integer');
  });

  test('booleans default to on where the feature is on by default', () => {
    expect(parseSettings({}).enabled).toBe(true);
    expect(parseSettings({ enabled: false }).enabled).toBe(false);
    expect(parseSettings({}).usePageContext).toBe(true);
    expect(parseSettings({}).inlineMode).toBe(false);
  });

  test('disabled sites are normalised and deduplicated', () => {
    expect(parseSettings({ disabledSites: ['www.Amazon.CA', 'amazon.ca', 7] }).disabledSites)
      .toEqual(['amazon.ca']);
  });
});

describe('storage round trip', () => {
  test('a proxied array must not reach storage as an object', () => {
    // Svelte 5 hands `$state` arrays over as Proxies, and chrome.storage
    // serialises those as {"0":"JPY"}. parseSettings then sees a non-array and
    // silently reverts to the defaults, losing every paused site.
    const proxied = new Proxy(['JPY', 'USD'], {});
    const stored = JSON.parse(JSON.stringify(parseSettings({ targetCurrencies: proxied })));
    expect(Array.isArray(stored.targetCurrencies)).toBe(true);
    expect(parseSettings(stored).targetCurrencies).toEqual(['JPY', 'USD']);
  });

  test('an object-shaped list is rejected rather than half-read', () => {
    expect(parseSettings({ targetCurrencies: { 0: 'JPY', 1: 'USD' } }).targetCurrencies)
      .toEqual(DEFAULT_SETTINGS.targetCurrencies);
  });
});

describe('migrateLegacy', () => {
  test('the first of the old flat list becomes the base', () => {
    expect(migrateLegacy(['EUR', 'USD', 'GBP'])).toEqual({
      ...DEFAULT_SETTINGS,
      baseCurrency: 'EUR',
      targetCurrencies: ['USD', 'GBP'],
    });
  });

  test('nothing stored means nothing to migrate', () => {
    expect(migrateLegacy(undefined)).toBeNull();
    expect(migrateLegacy([])).toBeNull();
    expect(migrateLegacy(['NOPE'])).toBeNull();
  });
});

describe('site switches', () => {
  const settings = { ...DEFAULT_SETTINGS, disabledSites: ['amazon.ca'] };

  test('www is not part of a site identity', () => {
    expect(normalizeHostname('www.Amazon.ca')).toBe('amazon.ca');
    expect(isSiteDisabled(settings, 'www.amazon.ca')).toBe(true);
  });

  test('a subdomain is its own site', () => {
    expect(isSiteDisabled(settings, 'smile.amazon.ca')).toBe(false);
  });

  test('the master switch outranks the per-site list', () => {
    expect(isActiveOn(settings, 'example.com')).toBe(true);
    expect(isActiveOn(settings, 'amazon.ca')).toBe(false);
    expect(isActiveOn({ ...settings, enabled: false }, 'example.com')).toBe(false);
  });
});

describe('displayCurrencies', () => {
  test('the base currency comes first', () => {
    expect(displayCurrencies({ ...DEFAULT_SETTINGS, baseCurrency: 'JPY', targetCurrencies: ['USD', 'EUR'] }))
      .toEqual(['JPY', 'USD', 'EUR']);
  });
});
