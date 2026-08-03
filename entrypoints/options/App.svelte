<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { CRYPTO_ASSETS } from '../../src/crypto';
  import { ASSET_BY_CODE, CURRENCIES, CURRENCY_BY_CODE, flagToCountryCode } from '../../src/currencies';
  import { flagImage } from '../../src/flags';
  import { dropCryptoAccess, hasCryptoAccess, requestCryptoAccess, watchCryptoRevoked } from '../../src/permissions';
  import { formatCurrencyAmount } from '../../src/formatter';
  import { t, uiLocale } from '../../src/i18n';
  import { MESSAGE, send } from '../../src/messages';
  import {
    HOVER_DELAY_CHOICES, defaultSettings, parseHostnameInput, readSettings, updateSettings,
    watchSettings,
  } from '../../src/settings';
  import type { Rounding, Settings, SettingsPatch } from '../../src/settings';
  import { formatAgo } from '../../src/time';
  import { STALE_AFTER_MS, STORAGE } from '../../src/types';

  let settings = $state<Settings>(defaultSettings());
  let ratesTimestamp = $state(0);
  let refreshing = $state(false);
  let error = $state('');
  let siteError = $state('');
  let addSite = $state('');
  let currencyFilter = $state('');
  let showWelcome = $state(false);
  let confirmingReset = $state(false);
  let loaded = $state(false);
  /** What the browser says, not what the settings key remembers. */
  let cryptoGranted = $state(false);
  /** False until a read actually succeeded: writing before that persists defaults over real data. */
  let canSave = $state(false);

  const version = chrome.runtime.getManifest().version;
  let unwatch: (() => void) | null = null;
  let unwatchRates: (() => void) | null = null;

  onMount(async () => {
    // The page ships in eight locales, so the document language cannot be a
    // constant in the HTML.
    document.documentElement.lang = uiLocale();

    // The background opens this page with #welcome on a fresh install, so the
    // banner needs no storage flag of its own.
    showWelcome = location.hash === '#welcome';

    // Subscribed before the first await, for two reasons: a write landing while
    // we read would fire into no listener, and a tab closed that fast would run
    // `onDestroy` before the assignment and leak the listener.
    // A popup, or a second options tab, writes the same key. Without this, the
    // snapshot goes stale and the next write hands back yesterday's list.
    let live = false;
    try {
      unwatch = watchSettings((next) => {
        live = true;
        settings = next;
        canSave = true;
        if (error === t('loadFailed')) error = '';
      });
      // This tab outlives a background refresh, so the rates label cannot be
      // read once and left.
      unwatchRates = watchRatesTimestamp((next) => (ratesTimestamp = next));
    } catch (e) {
      console.error('[PH] cannot watch storage', e);
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
      const stored = await chrome.storage.local.get([STORAGE.RATES_TS]);
      const ts = stored?.[STORAGE.RATES_TS];
      if (!ratesTimestamp) ratesTimestamp = typeof ts === 'number' ? ts : 0;
    } catch (e) {
      console.error('[PH] rates timestamp read failed', e);
    }

    cryptoGranted = await hasCryptoAccess();
  });

  onDestroy(() => { unwatch?.(); unwatchRates?.(); unwatchCrypto?.(); });

  // A permission taken away from the browser's own panel never passes through
  // this page, and the switch would sit there saying "on".
  const unwatchCrypto = watchCryptoRevoked(() => { cryptoGranted = false; });

  function watchRatesTimestamp(onChange: (timestamp: number) => void): () => void {
    const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
      if (areaName !== 'local' || !changes[STORAGE.RATES_TS]) return;
      const next = changes[STORAGE.RATES_TS].newValue;
      onChange(typeof next === 'number' ? next : 0);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  /**
   * The new value lands in `settings` only once storage has taken it, so the UI
   * can never show a switch the browser did not persist. `restore` puts back a
   * control the browser changed on its own (a checkbox and a select both commit
   * before the handler runs, and an unchanged `settings` re-renders to nothing).
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

  // Everything derived from a list reads that list back from storage rather than
  // from the local snapshot: two quick clicks would otherwise both build on the
  // value read before the first write, and the second would drop the first.
  function setBase(select: HTMLSelectElement): void {
    const code = select.value;
    // The base can never also be a target: it would appear twice in the tooltip.
    void update(
      (current) => ({ baseCurrency: code, targetCurrencies: current.targetCurrencies.filter((c) => c !== code) }),
      () => { select.value = settings.baseCurrency; }
    );
  }

  function toggle(key: 'enabled' | 'inlineMode' | 'usePageContext', box: HTMLInputElement): void {
    void update({ [key]: box.checked }, () => { box.checked = settings[key]; });
  }

  /**
   * The permission request is the first thing this function does, before any
   * await. A settings read first would spend the user gesture, and Firefox
   * rejects a permission request made outside one without ever prompting.
   *
   * Turning it off gives the permission back rather than merely forgetting it:
   * a granted host that nothing uses is still a granted host.
   */
  function toggleCrypto(box: HTMLInputElement): void {
    if (!box.checked) {
      void update({ cryptoEnabled: false }, () => { box.checked = settings.cryptoEnabled; })
        .then(() => dropCryptoAccess())
        .then(() => { cryptoGranted = false; });
      return;
    }

    void requestCryptoAccess().then(async (granted) => {
      cryptoGranted = granted;
      if (!granted) {
        box.checked = false;
        error = t('cryptoDenied');
        return;
      }
      error = '';
      await update({ cryptoEnabled: true }, () => { box.checked = false; });
    });
  }

  function addTarget(code: string): void {
    if (code === settings.baseCurrency || settings.targetCurrencies.includes(code)) return;
    void update((current) => ({
      targetCurrencies: current.targetCurrencies.includes(code)
        ? current.targetCurrencies
        : [...current.targetCurrencies, code],
    }));
  }

  function removeTarget(code: string): void {
    void update((current) => ({ targetCurrencies: current.targetCurrencies.filter((c) => c !== code) }));
  }

  function moveTarget(code: string, delta: number): void {
    void update((current) => {
      const next = [...current.targetCurrencies];
      const from = next.indexOf(code);
      const to = from + delta;
      if (from === -1 || to < 0 || to >= next.length) return {};
      [next[from], next[to]] = [next[to], next[from]];
      return { targetCurrencies: next };
    });
  }

  function pauseSite(): void {
    if (!addSite.trim()) return;
    // A port, a space or a stray path can never match `location.hostname`, so
    // the entry would sit in the list looking effective and pausing nothing.
    const host = parseHostnameInput(addSite);
    if (!host) { siteError = t('invalidSite'); return; }

    siteError = '';
    addSite = '';
    void update((current) => ({
      disabledSites: current.disabledSites.includes(host)
        ? current.disabledSites
        : [...current.disabledSites, host],
    }));
  }

  function resumeSite(host: string): void {
    void update((current) => ({ disabledSites: current.disabledSites.filter((s) => s !== host) }));
  }

  async function refresh(): Promise<void> {
    refreshing = true;
    const result = await send<{ ok: boolean; timestamp?: number }>(MESSAGE.REFRESH_RATES);
    refreshing = false;
    if (!result?.ok) { error = t('refreshFailed'); return; }
    error = '';
    ratesTimestamp = result.timestamp ?? Date.now();
  }

  /** Two steps on purpose: one stray click used to take the whole paused-site list with it. */
  function confirmReset(): void {
    confirmingReset = false;
    void update(defaultSettings());
  }

  /**
   * ARIA's radiogroup is one tab stop: arrows move the selection, Home and End
   * jump to the ends. The segmented controls looked like this already and
   * behaved like a row of unrelated buttons.
   */
  function onSegmentKeydown(event: KeyboardEvent, index: number, count: number, select: (index: number) => void): void {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % count;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else return;

    event.preventDefault();
    const group = (event.currentTarget as HTMLElement).parentElement;
    (group?.children[next] as HTMLElement | undefined)?.focus();
    select(next);
  }

  const targetCurrencies = $derived(
    settings.targetCurrencies
      .map((code) => ASSET_BY_CODE.get(code))
      .filter((c): c is NonNullable<typeof c> => c !== undefined)
  );

  const availableCurrencies = $derived.by(() => {
    const chosen = new Set([settings.baseCurrency, ...settings.targetCurrencies]);
    const filter = currencyFilter.trim().toLowerCase();
    // Crypto joins the picker only once the host permission is actually held.
    // Offering a row the extension cannot price is offering nothing.
    const pool = settings.cryptoEnabled && cryptoGranted
      ? [...CURRENCIES, ...CRYPTO_ASSETS]
      : CURRENCIES;
    return pool.filter(
      (c) =>
        !chosen.has(c.code) &&
        (!filter || c.code.toLowerCase().includes(filter) || c.name.toLowerCase().includes(filter))
    );
  });

  const stale = $derived(ratesTimestamp > 0 && Date.now() - ratesTimestamp > STALE_AFTER_MS);
  const ratesLabel = $derived(
    ratesTimestamp === 0 ? t('ratesNever') : t('ratesUpdated', formatAgo(ratesTimestamp))
  );

  // Rounding is hard to describe and trivial to demonstrate.
  const ROUNDING_MODES: Rounding[] = ['exact', 'smart', 'integer'];
  const roundingLabel: Record<Rounding, string> = {
    exact: 'roundingExact', smart: 'roundingSmart', integer: 'roundingInteger',
  };

  // Which option holds the group's single tab stop. A stored value outside the
  // offered choices would otherwise leave the whole group unreachable by keyboard.
  const delayIndex = $derived(
    Math.max((HOVER_DELAY_CHOICES as readonly number[]).indexOf(settings.hoverDelayMs), 0)
  );
  const roundingIndex = $derived(Math.max(ROUNDING_MODES.indexOf(settings.rounding), 0));
  const roundingSample = $derived.by(() => {
    const map = {} as Record<Rounding, string>;
    for (const mode of ROUNDING_MODES) {
      map[mode] = `${formatCurrencyAmount(1234.567, settings.baseCurrency, mode)} · ${formatCurrencyAmount(9.99, settings.baseCurrency, mode)}`;
    }
    return map;
  });

  const flagOf = (code: string): string => {
    const currency = CURRENCY_BY_CODE.get(code);
    return currency ? flagImage(flagToCountryCode(currency.flag)) : '';
  };
</script>

<main>
  <header>
    <h1>{t('optionsTitle')}</h1>
    <span class="version">{t('version', version)}</span>
  </header>

  {#if showWelcome}
    <div class="welcome">
      <div>
        <strong>{t('welcomeTitle')}</strong>
        <p>{t('welcomeBody')}</p>
      </div>
      <button class="primary" type="button" onclick={() => (showWelcome = false)}>{t('welcomeDismiss')}</button>
    </div>
  {/if}

  <!-- Two explicit columns rather than an auto-fit grid: the currency picker is
       twice the height of anything else, and letting the browser place cards
       left a column-tall hole under Behaviour. -->
  <div class="columns">
    <div class="col">
    <section>
      <h2>{t('sectionCurrencies')}</h2>

      <div class="field">
        <label for="base">{t('baseCurrency')}</label>
        <p class="help">{t('baseCurrencyHelp')}</p>
        <div class="select-row">
          {#if flagOf(settings.baseCurrency)}
            <img class="flag" src={flagOf(settings.baseCurrency)} alt="" />
          {/if}
          <select id="base" value={settings.baseCurrency} onchange={(e) => setBase(e.currentTarget)}>
            {#each CURRENCIES as currency (currency.code)}
              <option value={currency.code}>{currency.code} · {currency.name}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="field">
        <span class="label">{t('convertTo')}</span>
        <p class="help">{t('convertToHelp')}</p>

        <ul class="chosen">
          {#each targetCurrencies as currency, index (currency.code)}
            <li>
              {#if flagImage(flagToCountryCode(currency.flag))}
                <img class="flag" src={flagImage(flagToCountryCode(currency.flag))} alt="" />
              {:else}
                <span class="flag-fb">{currency.flag}</span>
              {/if}
              <span class="code">{currency.code}</span>
              <span class="name">{currency.name}</span>
              <button
                class="icon" type="button"
                title={t('moveUp')} aria-label={`${t('moveUp')}: ${currency.code}`}
                disabled={index === 0}
                onclick={() => moveTarget(currency.code, -1)}
              ><span aria-hidden="true">↑</span></button>
              <button
                class="icon" type="button"
                title={t('moveDown')} aria-label={`${t('moveDown')}: ${currency.code}`}
                disabled={index === targetCurrencies.length - 1}
                onclick={() => moveTarget(currency.code, 1)}
              ><span aria-hidden="true">↓</span></button>
              <button
                class="icon" type="button"
                title={t('remove')} aria-label={`${t('remove')}: ${currency.code}`}
                onclick={() => removeTarget(currency.code)}
              ><span aria-hidden="true">✕</span></button>
            </li>
          {:else}
            <li class="muted">{t('noResults')}</li>
          {/each}
        </ul>

        <input
          type="text"
          class="filter"
          placeholder={t('searchLabel')}
          aria-label={t('searchLabel')}
          bind:value={currencyFilter}
        />
        <ul class="available">
          {#each availableCurrencies as currency (currency.code)}
            <li>
              <button type="button" onclick={() => addTarget(currency.code)}>
                {#if flagImage(flagToCountryCode(currency.flag))}
                  <img class="flag" src={flagImage(flagToCountryCode(currency.flag))} alt="" />
                {:else}
                  <span class="flag-fb">{currency.flag}</span>
                {/if}
                <span class="code">{currency.code}</span>
                <span class="name">{currency.name}</span>
                <span class="plus" aria-hidden="true">+</span>
              </button>
            </li>
          {/each}
        </ul>
      </div>

      <div class="field">
        <label class="switch">
          <input
            type="checkbox"
            checked={settings.cryptoEnabled && cryptoGranted}
            onchange={(e) => toggleCrypto(e.currentTarget)}
          />
          <span>{t('cryptoEnabled')}</span>
        </label>
        <p class="help">{t('cryptoEnabledHelp')}</p>
      </div>
    </section>

    <section>
      <h2>{t('sectionSites')}</h2>
      <span class="label">{t('pausedSites')}</span>
      <ul class="sites">
        {#each settings.disabledSites as host (host)}
          <li>
            <span class="host">{host}</span>
            <button
              class="icon" type="button"
              title={t('remove')} aria-label={`${t('remove')}: ${host}`}
              onclick={() => resumeSite(host)}
            ><span aria-hidden="true">✕</span></button>
          </li>
        {:else}
          <li class="muted">{t('pausedSitesEmpty')}</li>
        {/each}
      </ul>
      <form class="add-site" onsubmit={(e) => { e.preventDefault(); pauseSite(); }}>
        <input
          type="text"
          placeholder={t('addSitePlaceholder')}
          aria-label={t('pausedSites')}
          aria-invalid={siteError ? 'true' : undefined}
          aria-describedby={siteError ? 'add-site-error' : undefined}
          bind:value={addSite}
          oninput={() => (siteError = '')}
        />
        <button class="primary" type="submit">{t('add')}</button>
      </form>
      {#if siteError}
        <p class="field-error" id="add-site-error" role="alert">{siteError}</p>
      {/if}
    </section>
    </div>

    <div class="col">
    <section>
      <h2>{t('sectionBehaviour')}</h2>

      <label class="switch">
        <input type="checkbox" checked={settings.enabled} onchange={(e) => toggle('enabled', e.currentTarget)} />
        <span>{t('enabledEverywhere')}</span>
      </label>
      <p class="help">{t('enabledEverywhereHelp')}</p>

      <div class="field">
        <span class="label" id="hover-delay-label">{t('hoverDelay')}</span>
        <p class="help">{t('hoverDelayHelp')}</p>
        <div class="segments" role="radiogroup" aria-labelledby="hover-delay-label">
          {#each HOVER_DELAY_CHOICES as choice, index (choice)}
            <button
              type="button"
              role="radio"
              class:on={settings.hoverDelayMs === choice}
              aria-checked={settings.hoverDelayMs === choice}
              tabindex={index === delayIndex ? 0 : -1}
              onclick={() => update({ hoverDelayMs: choice })}
              onkeydown={(e) => onSegmentKeydown(e, index, HOVER_DELAY_CHOICES.length,
                (next) => update({ hoverDelayMs: HOVER_DELAY_CHOICES[next] }))}
            >{choice === 0 ? t('delayInstant') : `${choice} ms`}</button>
          {/each}
        </div>
      </div>

      <div class="field">
        <span class="label" id="rounding-label">{t('rounding')}</span>
        <p class="help">{t('roundingHelp')}</p>
        <div class="segments" role="radiogroup" aria-labelledby="rounding-label">
          {#each ROUNDING_MODES as mode, index (mode)}
            <button
              type="button"
              role="radio"
              class:on={settings.rounding === mode}
              aria-checked={settings.rounding === mode}
              tabindex={index === roundingIndex ? 0 : -1}
              onclick={() => update({ rounding: mode })}
              onkeydown={(e) => onSegmentKeydown(e, index, ROUNDING_MODES.length,
                (next) => update({ rounding: ROUNDING_MODES[next] }))}
            >{t(roundingLabel[mode])}</button>
          {/each}
        </div>
        <p class="sample">{roundingSample[settings.rounding]}</p>
      </div>

      <label class="switch">
        <input type="checkbox" checked={settings.inlineMode} onchange={(e) => toggle('inlineMode', e.currentTarget)} />
        <span>{t('inlineMode')}</span>
      </label>
      <p class="help">{t('inlineModeHelp')}</p>

      <label class="switch">
        <input type="checkbox" checked={settings.usePageContext} onchange={(e) => toggle('usePageContext', e.currentTarget)} />
        <span>{t('pageContext')}</span>
      </label>
      <p class="help">{t('pageContextHelp')}</p>
    </section>

    <section>
      <h2>{t('sectionAbout')}</h2>
      <div class="rates-row">
        <span class:warn={stale}>{ratesLabel}</span>
        <button type="button" onclick={refresh} disabled={refreshing}>
          {refreshing ? t('refreshing') : t('refresh')}
        </button>
      </div>
      <p class="help">{t('privacyNote')}</p>
      <p>
        <a href="https://klnuno.github.io/PriceHover/PRIVACY" target="_blank" rel="noreferrer">
          {t('privacyPolicy')}
        </a>
      </p>
      {#if confirmingReset}
        <p class="reset-warning" role="alert">{t('resetWarning')}</p>
      {/if}
      <!-- One button that changes its own label, never two swapped in and out:
           unmounting the one the user just pressed drops keyboard focus to the
           body, which is where a confirmation step must not send anyone. -->
      <div class="reset-row">
        <button
          class="danger" type="button"
          onclick={() => (confirmingReset ? confirmReset() : (confirmingReset = true))}
        >{confirmingReset ? t('resetConfirm') : t('reset')}</button>
        {#if confirmingReset}
          <button type="button" onclick={() => (confirmingReset = false)}>{t('resetCancel')}</button>
        {/if}
      </div>
    </section>
    </div>
  </div>

  {#if error}<div class="err" role="alert">{error}</div>{/if}
</main>

<style>
  :global(*) { box-sizing: border-box; margin: 0; padding: 0; }

  /*
   * Three surfaces, not two. The page, the card that sits on it, and the
   * controls inside the card each need their own value, or a card outlined at
   * 1px on the same background as the page reads as a stray border rather than
   * as a container.
   */
  :global(:root) {
    --bg: #f6f6f7;
    --surface: #ffffff;
    --surface2: #f1f1f4;
    --surface3: #e7e7ec;
    --fg: #17171a;
    --fg2: #6b6b76;
    --border: #e3e3e8;
    --border-strong: #cdcdd5;
    --green: #17803d;
    --warn: #92610f;
    --focus: #2b6cff;
    --danger: #c0392b;
    --shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 10px 26px -16px rgb(0 0 0 / 0.16);
    --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.08);
    --radius: 14px;
    --radius-md: 10px;
    --radius-sm: 8px;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #0e0e10;
      --surface: #171719;
      --surface2: #202024;
      --surface3: #2b2b32;
      --fg: #ececf0;
      --fg2: #9a9aa6;
      --border: #26262c;
      --border-strong: #37373f;
      --green: #5fcc6f;
      --warn: #e0a23c;
      --focus: #6ea0ff;
      --danger: #ef7a6d;
      --shadow: 0 1px 2px rgb(0 0 0 / 0.4), 0 12px 32px -18px rgb(0 0 0 / 0.8);
      --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.4);
    }
  }

  :global(body) {
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  /* Every hover and toggle in here animates; none of them may animate for a
     reader who asked the OS to stop. */
  @media (prefers-reduced-motion: reduce) {
    :global(*) { transition: none !important; }
  }

  main { max-width: 980px; margin: 0 auto; padding: 36px 20px 72px; }

  header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 22px; }
  h1 { font-size: 23px; font-weight: 680; letter-spacing: -0.015em; }
  .version {
    font-size: 11px; font-weight: 600; color: var(--fg2);
    padding: 2px 8px; border: 1px solid var(--border);
    border-radius: 999px; background: var(--surface);
  }

  .welcome {
    display: flex; align-items: center; gap: 16px;
    padding: 14px 16px; margin-bottom: 22px;
    border: 1px solid var(--border); border-left: 3px solid var(--green);
    border-radius: var(--radius-md); background: var(--surface);
    box-shadow: var(--shadow);
  }
  .welcome strong { font-size: 14px; }
  .welcome p { font-size: 13px; color: var(--fg2); }
  .welcome button { margin-left: auto; flex-shrink: 0; }

  .columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(370px, 1fr)); gap: 20px; align-items: start; }
  .col { display: flex; flex-direction: column; gap: 20px; }

  section {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  h2 {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.075em; color: var(--fg2);
    padding-bottom: 12px; margin-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }

  .field { margin-bottom: 22px; }
  .field:last-child { margin-bottom: 0; }
  label, .label { display: block; font-weight: 620; font-size: 13.5px; letter-spacing: -0.005em; }
  .help { font-size: 12.5px; color: var(--fg2); line-height: 1.45; margin: 3px 0 10px; }

  .select-row { display: flex; align-items: center; gap: 8px; }
  select, input[type='text'] {
    flex: 1; min-width: 0;
    background: var(--surface2); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 8px 10px; font: inherit; font-size: 13px;
    transition: border-color 0.12s, background 0.12s;
  }
  select:hover, input[type='text']:hover { border-color: var(--border-strong); }
  select:focus, input:focus { outline: 2px solid var(--focus); outline-offset: -1px; }

  .flag { width: 20px; height: 15px; object-fit: cover; border-radius: 2px; flex-shrink: 0; }
  /* Same box as a flag, so a crypto row lines up with the fiat ones above it. */
  .flag-fb {
    width: 20px; flex-shrink: 0; text-align: center;
    font-size: 13px; line-height: 15px; color: var(--fg2);
  }

  ul { list-style: none; }

  .chosen li, .sites li, .available button {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 10px; width: 100%;
    border: 1px solid transparent; border-radius: var(--radius-sm);
    background: var(--surface2); color: inherit; font: inherit; text-align: left;
    transition: background 0.12s, border-color 0.12s;
  }
  .chosen li { margin-bottom: 5px; }
  .sites li { margin-bottom: 5px; }
  .chosen li:hover, .sites li:hover { border-color: var(--border); }
  /* The filter is the width of the list it filters, not of its own text. */
  .filter { width: 100%; flex: none; }
  .available {
    max-height: 268px; overflow-y: auto; margin-top: 8px; padding-right: 4px;
    scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent;
    /* The last row fades instead of being sliced, which is what says "there is
       more" without a scrollbar having to be visible to say it. */
    mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent);
  }
  .available li { margin-bottom: 3px; }
  .available button { cursor: pointer; background: transparent; }
  .available button:hover { background: var(--surface2); border-color: var(--border); }
  .available button:hover .plus { color: var(--fg); }
  .available button:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }

  .code {
    font-weight: 680; font-size: 12px; min-width: 38px;
    font-variant-numeric: tabular-nums; letter-spacing: 0.01em;
  }
  .name, .host { color: var(--fg2); font-size: 12.5px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .plus { color: var(--fg2); font-size: 15px; line-height: 1; transition: color 0.12s; }
  .muted { color: var(--fg2); font-size: 12.5px; padding: 7px 10px; }

  button {
    font: inherit; font-size: 12.5px; font-weight: 600;
    color: var(--fg); background: var(--surface);
    border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
    padding: 7px 13px; cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  button:hover:not(:disabled) { background: var(--surface2); border-color: var(--fg2); }
  button:disabled { opacity: 0.4; cursor: default; }
  button:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  /* One filled button per card at most: the thing that card is for. */
  button.primary { background: var(--fg); color: var(--surface); border-color: var(--fg); }
  button.primary:hover:not(:disabled) { background: var(--fg); border-color: var(--fg); opacity: 0.86; }
  button.icon {
    padding: 3px 8px; background: transparent; border-color: transparent;
    color: var(--fg2); font-size: 13px;
  }
  button.icon:hover:not(:disabled) { background: var(--surface3); border-color: transparent; color: var(--fg); }
  button.danger { color: var(--danger); border-color: var(--danger); background: transparent; margin-top: 14px; }
  button.danger:hover:not(:disabled) { background: var(--danger); border-color: var(--danger); color: var(--surface); }

  .switch { display: flex; align-items: center; gap: 10px; font-weight: 620; font-size: 13.5px; cursor: pointer; }
  /*
   * A drawn track rather than `accent-color` on a native box. The native
   * control is a checkbox, and every one of these settings is a thing that is
   * on or off right now, which is what a switch says and a checkbox does not.
   */
  .switch input {
    appearance: none; -webkit-appearance: none;
    position: relative; flex: none; margin: 0;
    width: 34px; height: 20px; border-radius: 999px;
    background: var(--surface3); border: 1px solid var(--border-strong);
    cursor: pointer; transition: background 0.16s, border-color 0.16s;
  }
  .switch input::after {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 14px; height: 14px; border-radius: 50%;
    background: #ffffff; box-shadow: var(--shadow-sm);
    transition: translate 0.16s ease;
  }
  .switch input:checked { background: var(--green); border-color: var(--green); }
  .switch input:checked::after { translate: 14px 0; }
  .switch input:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

  /* One track holding its options, so the group reads as one control with a
     current value rather than as a row of unrelated buttons. */
  .segments {
    display: inline-flex; flex-wrap: wrap; gap: 2px;
    padding: 3px; border: 1px solid var(--border);
    border-radius: var(--radius-md); background: var(--surface2);
  }
  .segments button {
    background: transparent; border-color: transparent; color: var(--fg2);
    border-radius: 7px; padding: 5px 11px;
  }
  .segments button:hover:not(.on) { background: var(--surface3); border-color: transparent; color: var(--fg); }
  .segments button.on {
    background: var(--surface); color: var(--fg);
    border-color: var(--border); box-shadow: var(--shadow-sm);
  }

  .sample {
    margin-top: 10px; padding: 8px 11px;
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    background: var(--surface2); color: var(--fg);
    font-size: 12.5px; font-weight: 620; font-variant-numeric: tabular-nums;
  }

  .add-site { display: flex; gap: 8px; margin-top: 10px; }
  .field-error { margin-top: 8px; font-size: 12.5px; color: var(--danger); }

  .reset-warning { margin-top: 14px; font-size: 12.5px; color: var(--danger); }
  .reset-row { display: flex; gap: 8px; margin-top: 14px; }
  .reset-row button { margin-top: 0; }

  .rates-row {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 12px; margin-bottom: 12px;
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    background: var(--surface2); font-size: 13px;
  }
  .rates-row span { margin-right: auto; color: var(--fg2); }
  .warn { color: var(--warn); font-weight: 620; }

  a { color: var(--focus); font-size: 12.5px; font-weight: 600; text-underline-offset: 2px; }

  .err {
    margin-top: 18px; padding: 10px 12px;
    border: 1px solid var(--danger); border-radius: var(--radius-sm);
    background: var(--surface); color: var(--danger); font-size: 12.5px;
  }
</style>
