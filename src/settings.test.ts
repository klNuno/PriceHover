import { afterEach, describe, expect, test } from 'bun:test';
import {
  DEFAULT_SETTINGS, defaultSettings, displayCurrencies, isActiveOn, isSiteDisabled, migrateLegacy,
  normalizeHostname, parseHostnameInput, parseSettings, readSettings, updateSettings,
} from './settings';
import { STORAGE } from './types';

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

describe('parseHostnameInput', () => {
  test('a pasted URL becomes the site it names', () => {
    expect(parseHostnameInput('HTTPS://WWW.Amazon.ca:443/dp/B0?x=1#f')).toBe('amazon.ca');
    expect(parseHostnameInput('  example.com  ')).toBe('example.com');
    expect(parseHostnameInput('example.com.')).toBe('example.com');
  });

  test('a port never survives: location.hostname has none, so it could never match', () => {
    expect(parseHostnameInput('example.com:8080')).toBe('example.com');
  });

  test('what cannot be a hostname is rejected rather than stored', () => {
    for (const input of ['', '   ', 'my site', 'http://', 'a..b', 'exa mple.com', '.']) {
      expect(parseHostnameInput(input)).toBeNull();
    }
  });

  test('a host no registry would sell is still a host', () => {
    // Intranet names, underscores and hand-typed IDNs all reach the browser.
    expect(parseHostnameInput('my_host.local')).toBe('my_host.local');
    expect(parseHostnameInput('münchen.de')).toBe('münchen.de');
    expect(parseHostnameInput('localhost')).toBe('localhost');
  });

  test('stored entries are normalised but never dropped', () => {
    // `updateSettings` writes the parsed object straight back, so validating on
    // the read path would delete a paused site on the user's next click.
    expect(parseSettings({ disabledSites: ['example.com:8080', 'not a host', 'HTTPS://x.dev'] }).disabledSites)
      .toEqual(['example.com', 'not a host', 'x.dev']);
  });
});

describe('defaultSettings', () => {
  test('the module-level defaults cannot be mutated through a copy', () => {
    const copy = defaultSettings();
    copy.disabledSites.push('example.com');
    copy.targetCurrencies.push('JPY');
    expect(DEFAULT_SETTINGS.disabledSites).toEqual([]);
    expect(DEFAULT_SETTINGS.targetCurrencies).toEqual(['USD', 'GBP']);
  });
});

// ── Storage-backed behaviour ───────────────────────────────────────────────

interface StubOptions { failGet?: boolean; failSet?: boolean }

const realChrome = (globalThis as Record<string, unknown>).chrome;

function stubStorage(initial: Record<string, unknown>, options: StubOptions = {}): Record<string, unknown> {
  const data: Record<string, unknown> = structuredClone(initial);
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        async get(keys: string[]): Promise<Record<string, unknown>> {
          if (options.failGet) throw new Error('storage unavailable');
          const out: Record<string, unknown> = {};
          for (const key of keys) if (key in data) out[key] = structuredClone(data[key]);
          return out;
        },
        async set(items: Record<string, unknown>): Promise<void> {
          if (options.failSet) throw new Error('quota exceeded');
          // structuredClone is what the real API does, and what turns a proxied
          // array into an object if one ever reaches it.
          Object.assign(data, structuredClone(items));
        },
      },
    },
  };
  return data;
}

afterEach(() => {
  (globalThis as Record<string, unknown>).chrome = realChrome;
});

describe('readSettings', () => {
  test('an empty store and a broken store are not the same answer', async () => {
    stubStorage({});
    expect((await readSettings()).source).toBe('empty');

    stubStorage({ [STORAGE.SETTINGS]: { baseCurrency: 'JPY' } });
    expect((await readSettings()).source).toBe('stored');

    stubStorage({}, { failGet: true });
    const failed = await readSettings();
    expect(failed.source).toBe('failed');
    // Still usable, so the UI can render something; just not writable.
    expect(failed.settings.baseCurrency).toBe(DEFAULT_SETTINGS.baseCurrency);
  });
});

describe('updateSettings', () => {
  test('a patch cannot resurrect fields the caller last saw minutes ago', async () => {
    // The options page holds this snapshot, with one paused site.
    const stale = parseSettings({ disabledSites: ['a.com'] });
    // Meanwhile the popup pauses a second site.
    const data = stubStorage({ [STORAGE.SETTINGS]: { ...stale, disabledSites: ['a.com', 'b.com'] } });

    // The options page flips an unrelated switch.
    const next = await updateSettings({ enabled: false });

    expect(next.disabledSites).toEqual(['a.com', 'b.com']);
    expect(next.enabled).toBe(false);
    expect((data[STORAGE.SETTINGS] as { disabledSites: string[] }).disabledSites).toEqual(['a.com', 'b.com']);
  });

  test('a failed read never becomes a write of the defaults', async () => {
    stubStorage({ [STORAGE.SETTINGS]: { baseCurrency: 'JPY' } }, { failGet: true });
    await expect(updateSettings({ enabled: false })).rejects.toThrow();
  });

  test('a failed write rejects so the caller can put the switch back', async () => {
    stubStorage({ [STORAGE.SETTINGS]: { baseCurrency: 'JPY' } }, { failSet: true });
    await expect(updateSettings({ enabled: false })).rejects.toThrow();
  });

  test('two clicks in a row both land, the second patch sees the first', async () => {
    // Both handlers would otherwise build their array from the same snapshot,
    // and the write that finishes last would drop the other one.
    const data = stubStorage({ [STORAGE.SETTINGS]: { disabledSites: [] } });
    await Promise.all([
      updateSettings((current) => ({ disabledSites: [...current.disabledSites, 'a.com'] })),
      updateSettings((current) => ({ disabledSites: [...current.disabledSites, 'b.com'] })),
    ]);
    expect((data[STORAGE.SETTINGS] as { disabledSites: string[] }).disabledSites).toEqual(['a.com', 'b.com']);
  });

  test('a proxied array reaches storage as a real array', async () => {
    const data = stubStorage({ [STORAGE.SETTINGS]: { baseCurrency: 'EUR' } });
    await updateSettings({ targetCurrencies: new Proxy(['JPY', 'USD'], {}) });
    expect(Array.isArray((data[STORAGE.SETTINGS] as { targetCurrencies: unknown }).targetCurrencies)).toBe(true);
  });
});
