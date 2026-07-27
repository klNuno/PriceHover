<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { CURRENCIES, CURRENCY_BY_CODE, flagToCountryCode } from '../../src/currencies';
  import { flagImage } from '../../src/flags';
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
  });

  onDestroy(() => { unwatch?.(); unwatchRates?.(); });

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
      .map((code) => CURRENCY_BY_CODE.get(code))
      .filter((c): c is NonNullable<typeof c> => c !== undefined)
  );

  const availableCurrencies = $derived.by(() => {
    const chosen = new Set([settings.baseCurrency, ...settings.targetCurrencies]);
    const filter = currencyFilter.trim().toLowerCase();
    return CURRENCIES.filter(
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
      <button type="button" onclick={() => (showWelcome = false)}>{t('welcomeDismiss')}</button>
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
                {/if}
                <span class="code">{currency.code}</span>
                <span class="name">{currency.name}</span>
                <span class="plus" aria-hidden="true">+</span>
              </button>
            </li>
          {/each}
        </ul>
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
        <button type="submit">{t('add')}</button>
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

  :global(:root) {
    --bg: #ffffff;
    --bg2: #f5f5f5;
    --bg3: #ebebeb;
    --fg: #111111;
    --fg2: #616161;
    --border: #e0e0e0;
    --green: #1a8c2a;
    --warn: #9a6410;
    --focus: #2b6cff;
    --danger: #c0392b;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #111111;
      --bg2: #1a1a1a;
      --bg3: #242424;
      --fg: #f0f0f0;
      --fg2: #8f8f8f;
      --border: #2a2a2a;
      --green: #5fcc6f;
      --warn: #e0a23c;
      --focus: #6ea0ff;
      --danger: #ef7a6d;
    }
  }

  :global(body) {
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }

  main { max-width: 900px; margin: 0 auto; padding: 28px 20px 60px; }

  header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 20px; }
  h1 { font-size: 20px; font-weight: 700; }
  .version { font-size: 12px; color: var(--fg2); }

  .welcome {
    display: flex; align-items: center; gap: 16px;
    padding: 12px 14px; margin-bottom: 20px;
    border: 1px solid var(--border); border-left: 3px solid var(--green);
    border-radius: 6px; background: var(--bg2);
  }
  .welcome p { font-size: 13px; color: var(--fg2); }
  .welcome button { margin-left: auto; }

  .columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 18px; align-items: start; }
  .col { display: flex; flex-direction: column; gap: 18px; }

  section {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    background: var(--bg);
  }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg2); margin-bottom: 12px; }

  .field { margin-bottom: 18px; }
  .field:last-child { margin-bottom: 0; }
  label, .label { display: block; font-weight: 600; font-size: 13px; }
  .help { font-size: 12px; color: var(--fg2); margin: 2px 0 8px; }

  .select-row { display: flex; align-items: center; gap: 8px; }
  select, input[type='text'] {
    flex: 1; min-width: 0;
    background: var(--bg2); color: var(--fg);
    border: 1px solid var(--border); border-radius: 5px;
    padding: 6px 8px; font: inherit; font-size: 13px;
  }
  select:focus, input:focus { outline: 2px solid var(--focus); outline-offset: -1px; }

  .flag { width: 20px; height: 15px; object-fit: cover; border-radius: 2px; flex-shrink: 0; }

  ul { list-style: none; }

  .chosen li, .sites li, .available button {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 8px; width: 100%;
    border: 1px solid transparent; border-radius: 5px;
    background: var(--bg2); color: inherit; font: inherit; text-align: left;
  }
  .chosen li { margin-bottom: 4px; }
  .sites li { margin-bottom: 4px; }
  .available { max-height: 220px; overflow-y: auto; margin-top: 6px; scrollbar-width: thin; }
  .available li { margin-bottom: 3px; }
  .available button { cursor: pointer; background: transparent; }
  .available button:hover { background: var(--bg2); }
  .available button:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }

  .code { font-weight: 600; font-size: 12px; min-width: 34px; }
  .name, .host { color: var(--fg2); font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .plus { color: var(--fg2); font-size: 14px; }
  .muted { color: var(--fg2); font-size: 12px; padding: 5px 8px; }

  button {
    font: inherit; font-size: 12px;
    color: var(--fg); background: var(--bg2);
    border: 1px solid var(--border); border-radius: 5px;
    padding: 5px 10px; cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: var(--fg2); }
  button:disabled { opacity: 0.4; cursor: default; }
  button:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  button.icon { padding: 2px 7px; background: transparent; border-color: transparent; color: var(--fg2); }
  button.icon:hover:not(:disabled) { background: var(--bg3); color: var(--fg); }
  button.danger { color: var(--danger); border-color: var(--danger); background: transparent; margin-top: 12px; }

  .switch { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; cursor: pointer; }
  .switch input { width: 15px; height: 15px; accent-color: var(--green); cursor: pointer; }

  .segments { display: flex; flex-wrap: wrap; gap: 4px; }
  .segments button.on { background: var(--fg); color: var(--bg); border-color: var(--fg); }

  .sample { margin-top: 6px; font-size: 12px; color: var(--green); font-weight: 600; }

  .add-site { display: flex; gap: 6px; margin-top: 8px; }
  .field-error { margin-top: 6px; font-size: 12px; color: var(--danger); }

  .reset-warning { margin-top: 12px; font-size: 12px; color: var(--danger); }
  .reset-row { display: flex; gap: 6px; margin-top: 12px; }
  .reset-row button { margin-top: 0; }

  .rates-row { display: flex; align-items: center; gap: 10px; font-size: 13px; margin-bottom: 10px; }
  .rates-row span { margin-right: auto; color: var(--fg2); }
  .warn { color: var(--warn); }

  a { color: var(--focus); font-size: 12px; }

  .err { margin-top: 16px; padding: 8px 10px; border: 1px solid var(--danger); border-radius: 6px; color: var(--danger); font-size: 12px; }
</style>
