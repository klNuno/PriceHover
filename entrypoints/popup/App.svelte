<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { convertPrice } from '../../src/convert';
  import { CRYPTO_ASSETS, isCryptoCode } from '../../src/crypto';
  import { ASSET_BY_CODE, CURRENCIES, flagToCountryCode } from '../../src/currencies';
  import { flagImage } from '../../src/flags';
  import { t, uiLocale } from '../../src/i18n';
  import { MESSAGE, send } from '../../src/messages';
  import { parseQuery } from '../../src/query';
  import { parseCryptoTable, parseRates } from '../../src/rates';
  import {
    defaultSettings, isSiteDisabled, normalizeHostname, readSettings, updateSettings, wantsCrypto,
    watchSettings,
  } from '../../src/settings';
  import type { Settings, SettingsPatch } from '../../src/settings';
  import { formatAgo } from '../../src/time';
  import { CRYPTO_STALE_AFTER_MS, STALE_AFTER_MS, STORAGE } from '../../src/types';
  import type { ExchangeRates } from '../../src/types';

  let settings = $state<Settings>(defaultSettings());
  let fiatRates = $state<ExchangeRates | null>(null);
  let cryptoRates = $state<ExchangeRates | null>(null);
  let ratesTimestamp = $state(0);
  let cryptoTimestamp = $state(0);
  let query = $state('');
  let hostname = $state('');
  let refreshing = $state(false);
  let error = $state('');
  let loaded = $state(false);
  /** False until a read actually succeeded: writing before that persists defaults over real data. */
  let canSave = $state(false);

  const version = chrome.runtime.getManifest().version;
  let unwatch: (() => void) | null = null;

  onMount(async () => {
    // The page ships in eight locales, so the document language cannot be a
    // constant in the HTML.
    document.documentElement.lang = uiLocale();

    // Subscribed before the first await, for two reasons: a write landing while
    // we read would fire into no listener, and `onDestroy` on a popup closed
    // that fast would run before the assignment and leak the listener.
    // The options page and other popups write the same key. Without this, the
    // snapshot goes stale and the next write hands back yesterday's list.
    let live = false;
    try {
      unwatch = watchSettings((next) => {
        live = true;
        settings = next;
        canSave = true;
        if (error === t('loadFailed')) error = '';
      });
    } catch (e) {
      console.error('[PH] cannot watch settings', e);
    }

    const load = await readSettings();
    if (!live) settings = load.settings; // a change event already brought something newer
    canSave = canSave || load.source !== 'failed';
    if (load.source === 'failed') {
      console.error('[PH] settings read failed', load.error);
      if (!canSave) error = t('loadFailed');
    }
    loaded = true;

    try {
      await readRates();
    } catch (e) {
      console.error('[PH] rates read failed', e);
    }

    // `activeTab` gives the URL only because the user just clicked the icon,
    // which is exactly the gesture that should unlock a per-site switch.
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        const url = new URL(tab.url);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          hostname = normalizeHostname(url.hostname);
        }
      }
    } catch { /* no activeTab grant, or an internal page */ }
  });

  onDestroy(() => unwatch?.());

  /**
   * The new value lands in `settings` only once storage has taken it, so the UI
   * can never show a switch the browser did not persist. `restore` puts back a
   * control the browser flipped on its own (a checkbox is toggled before the
   * handler runs, and an unchanged `settings` re-renders to nothing).
   */
  async function update(patch: SettingsPatch, restore?: () => void): Promise<void> {
    if (!canSave) { if (loaded) error = t('loadFailed'); restore?.(); return; }
    try {
      settings = await updateSettings(patch);
      error = '';
    } catch (e) {
      console.error('[PH] settings write failed', e);
      error = t('saveFailed');
      restore?.();
    }
  }

  const siteDisabled = $derived(hostname ? isSiteDisabled(settings, hostname) : false);

  // Both lists are derived from the list already in storage, never from the
  // local snapshot: two quick clicks would otherwise both build on the value
  // read before the first write, and the second would drop the first.
  function toggleSite(): void {
    if (!hostname) return;
    void update((current) => ({
      disabledSites: isSiteDisabled(current, hostname)
        ? current.disabledSites.filter((s) => s !== hostname)
        : [...current.disabledSites, hostname],
    }));
  }

  function toggleTarget(code: string, box?: HTMLInputElement): void {
    if (code === settings.baseCurrency) return;
    void update(
      (current) => ({
        targetCurrencies: current.targetCurrencies.includes(code)
          ? current.targetCurrencies.filter((c) => c !== code)
          : [...current.targetCurrencies, code],
      }),
      () => { if (box) box.checked = settings.targetCurrencies.includes(code); }
    );
  }

  async function readRates(): Promise<void> {
    const stored = await chrome.storage.local.get([
      STORAGE.RATES, STORAGE.RATES_TS, STORAGE.CRYPTO_RATES, STORAGE.CRYPTO_TS,
    ]);
    fiatRates = parseRates(stored?.[STORAGE.RATES]);
    cryptoRates = parseCryptoTable(stored?.[STORAGE.CRYPTO_RATES]);
    const ts = stored?.[STORAGE.RATES_TS];
    const cryptoTs = stored?.[STORAGE.CRYPTO_TS];
    ratesTimestamp = typeof ts === 'number' ? ts : 0;
    cryptoTimestamp = typeof cryptoTs === 'number' ? cryptoTs : 0;
  }

  async function refresh(): Promise<void> {
    refreshing = true;
    // Both hosts, and the crypto one only when it would show something. Its
    // failure is not the fiat one's: the button reports the fiat result, which
    // is the one every user has.
    const result = await send<{ ok: boolean; timestamp?: number }>(MESSAGE.REFRESH_RATES);
    if (wantsCrypto(settings)) await send(MESSAGE.REFRESH_CRYPTO);
    refreshing = false;

    if (!result?.ok) { error = t('refreshFailed'); return; }
    error = '';
    await readRates();
    ratesTimestamp = result.timestamp ?? Date.now();
  }

  const parsed = $derived(parseQuery(query, settings.baseCurrency));
  const isCalc = $derived(parsed.price !== null);

  /** One table for everything downstream; the crypto half wins a collision. */
  const rates = $derived.by(() => {
    if (!fiatRates) return null;
    return cryptoRates ? { ...fiatRates, ...cryptoRates } : fiatRates;
  });

  /**
   * The label reports the older of the two sources whenever a crypto row is on
   * screen. "Rates 2 minutes ago" next to a five-hour-old BTC row would be true
   * about the fiat table and a lie about the number underneath it.
   */
  const cryptoShown = $derived(wantsCrypto(settings));
  const shownTimestamp = $derived(
    cryptoShown && cryptoTimestamp > 0 ? Math.min(ratesTimestamp, cryptoTimestamp) : ratesTimestamp
  );
  const stale = $derived(
    (ratesTimestamp > 0 && Date.now() - ratesTimestamp > STALE_AFTER_MS) ||
    (cryptoShown && cryptoTimestamp > 0 && Date.now() - cryptoTimestamp > CRYPTO_STALE_AFTER_MS)
  );

  const ratesLabel = $derived(
    shownTimestamp === 0 ? t('ratesNever') : t('ratesUpdated', formatAgo(shownTimestamp))
  );

  /**
   * Chosen currencies come first, in the order they are shown in the tooltip.
   * They used to be scattered through 44 alphabetically-fixed rows, which meant
   * scrolling to find the three the user actually picked.
   */
  const orderedCurrencies = $derived.by(() => {
    const chosen = [settings.baseCurrency, ...settings.targetCurrencies];
    const rank = new Map(chosen.map((code, index) => [code, index]));
    // Crypto is listed only when it is switched on. Forty-four rows plus
    // twenty-four nobody asked for is a list nobody scrolls.
    const pool = settings.cryptoEnabled ? [...CURRENCIES, ...CRYPTO_ASSETS] : CURRENCIES;
    return [...pool].sort((a, b) => {
      const ra = rank.get(a.code) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.code) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  });

  const visibleCurrencies = $derived.by(() => {
    if (parsed.targetCode) {
      const currency = ASSET_BY_CODE.get(parsed.targetCode);
      // A crypto code typed while crypto is off resolves to nothing rather
      // than to a row that can never be priced.
      if (currency && isCryptoCode(currency.code) && !settings.cryptoEnabled) return [];
      return currency ? [currency] : [];
    }
    if (parsed.filter) {
      return orderedCurrencies.filter(
        (c) =>
          c.code.toLowerCase().includes(parsed.filter) ||
          c.name.toLowerCase().includes(parsed.filter)
      );
    }
    return orderedCurrencies;
  });

  /** code → formatted amount, for whichever currencies are on screen. */
  const conversions = $derived.by(() => {
    const map = new Map<string, string>();
    if (!parsed.price || !rates) return map;

    const codes = visibleCurrencies.map((c) => c.code);
    for (const converted of convertPrice(parsed.price, rates, codes, settings.rounding)) {
      map.set(
        converted.currency.code,
        converted.formattedMax ? `${converted.formatted} – ${converted.formattedMax}` : converted.formatted
      );
    }
    return map;
  });

  function roleOf(code: string): 'base' | 'target' | null {
    if (code === settings.baseCurrency) return 'base';
    return settings.targetCurrencies.includes(code) ? 'target' : null;
  }
</script>

<div class="popup">
  <header>
    <span class="title">PriceHover</span>
    <span class="version">{t('version', version)}</span>
    <button class="icon" type="button" title={t('settings')} onclick={() => send(MESSAGE.OPEN_OPTIONS)}>
      {t('settings')}
    </button>
  </header>

  {#if loaded && !settings.enabled}
    <div class="banner">
      <span>{t('extensionOff')}</span>
      <button type="button" onclick={() => update({ enabled: true })}>{t('turnOn')}</button>
    </div>
  {:else if hostname}
    <div class="banner" class:muted={!siteDisabled}>
      <span>{siteDisabled ? t('pausedOnSite', hostname) : hostname}</span>
      <button type="button" onclick={toggleSite}>
        {siteDisabled ? t('resumeOnSite', hostname) : t('pauseOnSite', hostname)}
      </button>
    </div>
  {/if}

  <div class="search-wrap">
    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="text"
      class="search"
      placeholder={t('searchPlaceholder')}
      aria-label={t('searchLabel')}
      autofocus
      bind:value={query}
    />
  </div>

  <ul class="list">
    {#each visibleCurrencies as currency (currency.code)}
      {@const role = roleOf(currency.code)}
      {@const converted = conversions.get(currency.code)}
      {@const flagSrc = flagImage(flagToCountryCode(currency.flag))}
      <li>
        <label class="row" class:base={role === 'base'} class:target={role === 'target'}>
          <input
            type="checkbox"
            class="sr-only"
            checked={role !== null}
            disabled={role === 'base'}
            onchange={(e) => toggleTarget(currency.code, e.currentTarget)}
          />
          {#if flagSrc}
            <img class="flag" src={flagSrc} alt="" />
          {:else}
            <span class="flag-fb">{currency.flag}</span>
          {/if}
          <span class="code">{currency.code}</span>
          <span class="name">{currency.name}</span>
          <span class="right">
            {#if isCalc && converted}
              <span class="amount">{converted}</span>
            {:else if role === 'base'}
              <span class="tag">{t('baseCurrency')}</span>
            {:else if role === 'target'}
              <span class="check" aria-hidden="true">✓</span>
            {/if}
          </span>
        </label>
      </li>
    {/each}
    {#if visibleCurrencies.length === 0}
      <li class="empty">{t('noResults')}</li>
    {/if}
  </ul>

  <footer>
    <span class="rates" class:warn={stale}>{ratesLabel}</span>
    <button class="link" type="button" onclick={refresh} disabled={refreshing}>
      {refreshing ? t('refreshing') : t('refresh')}
    </button>
  </footer>

  {#if error}<div class="err" role="alert">{error}</div>{/if}
</div>

<style>
  :global(*) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(html), :global(body) { overflow: hidden !important; }

  :global(:root) {
    --bg: #ffffff;
    --bg2: #f5f5f5;
    --bg3: #ebebeb;
    --fg: #111111;
    --fg2: #616161;
    --accent: #000000;
    --border: #e0e0e0;
    --green: #1a8c2a;
    --warn: #9a6410;
    --focus: #2b6cff;
    --danger: #c0392b;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #111111;
      --bg2: #1c1c1c;
      --bg3: #272727;
      --fg: #f0f0f0;
      --fg2: #8f8f8f;
      --accent: #ffffff;
      --border: #2a2a2a;
      --green: #5fcc6f;
      --warn: #e0a23c;
      --focus: #6ea0ff;
      /* #c0392b on #111 is about 3.5:1, under AA. This is the options page's tone. */
      --danger: #ef7a6d;
    }
  }

  .popup {
    width: 330px;
    max-height: 480px;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 13px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px 9px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .title { font-weight: 700; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase; }
  .version { font-size: 10px; color: var(--fg2); margin-right: auto; }

  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 11px;
    background: var(--bg3);
    border-bottom: 1px solid var(--border);
  }
  .banner span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: auto; }
  .banner.muted { background: var(--bg2); color: var(--fg2); }

  button {
    font: inherit;
    font-size: 11px;
    color: var(--fg);
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 8px;
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover:not(:disabled) { border-color: var(--fg2); }
  button:disabled { opacity: 0.6; cursor: default; }
  button.link { background: none; border: 0; padding: 3px 4px; color: var(--fg2); text-decoration: underline; }

  .search-wrap { padding: 7px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .search {
    width: 100%;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 8px;
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    outline: none;
  }
  .search:focus { border-color: var(--focus); box-shadow: 0 0 0 2px color-mix(in srgb, var(--focus) 25%, transparent); }
  .search::placeholder { color: var(--fg2); }

  .list { flex: 1; overflow-y: auto; list-style: none; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }

  .row {
    display: grid;
    grid-template-columns: 22px 38px 1fr auto;
    align-items: center;
    gap: 0 8px;
    padding: 6px 12px;
    cursor: pointer;
    user-select: none;
  }
  .row:hover { background: var(--bg2); }
  .row.target { background: var(--bg2); }
  .row.base { background: var(--bg3); cursor: default; }
  /* The checkbox is clipped to a pixel for screen readers, so the visible focus
     ring has to come from its label. Without this, tabbing through 44 rows
     showed nothing at all. */
  .row:focus-within { outline: 2px solid var(--focus); outline-offset: -2px; }

  .flag { width: 20px; height: 15px; object-fit: cover; border-radius: 2px; }
  .flag-fb { font-size: 14px; line-height: 1; }
  .code { font-weight: 600; font-size: 12px; }
  .name { color: var(--fg2); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .right { text-align: right; min-width: 0; }
  .check { font-size: 11px; font-weight: 700; color: var(--accent); }
  .tag { font-size: 10px; color: var(--fg2); text-transform: uppercase; letter-spacing: 0.04em; }
  .amount { font-size: 12px; font-weight: 600; color: var(--green); white-space: nowrap; }

  .empty { padding: 14px 12px; color: var(--fg2); font-size: 12px; }

  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  .rates { font-size: 11px; color: var(--fg2); margin-right: auto; }
  .rates.warn { color: var(--warn); }

  .err { padding: 4px 12px; font-size: 10px; color: var(--danger); border-top: 1px solid var(--border); }

  .sr-only {
    position: absolute; width: 1px; height: 1px;
    padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0,0,0,0); white-space: nowrap; border: 0;
  }
</style>
