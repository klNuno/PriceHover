<script lang="ts">
  import { onMount } from 'svelte';
  import { CURRENCIES, CURRENCY_BY_CODE, flagToCountryCode } from '../../src/currencies';
  import { STORAGE, DEFAULT_CURRENCIES } from '../../src/types';
  import { detectPriceFromText } from '../../src/detector';
  import { formatCurrencyAmount } from '../../src/formatter';
  import type { DetectedPrice } from '../../src/types';

  interface TargetedConversionQuery {
    source: DetectedPrice;
    targetCode: string;
  }

  // Build alias map automatically from CURRENCIES names (first match wins = most common first).
  // Skips generic geographic words. Adds plurals and a few informal names.
  const CURRENCY_ALIASES = (() => {
    const skip = new Set(['us', 'uk', 'new', 'south', 'north', 'east', 'west', 'hong',
      'kong', 'saudi', 'united', 'arab', 'emirates', 'costa', 'rica', 'de', 'and']);
    const map = new Map<string, string>();
    for (const c of CURRENCIES) {
      map.set(c.code.toLowerCase(), c.code);
      for (const word of c.name.toLowerCase().split(/\s+/)) {
        if (word.length > 2 && !skip.has(word) && !map.has(word)) {
          map.set(word, c.code);
          if (!word.endsWith('s')) map.set(word + 's', c.code); // simple plural
        }
      }
    }
    // Informal names not derivable from official names
    for (const [alias, code] of [
      ['dol', 'USD'], ['buck', 'USD'], ['bucks', 'USD'],
      ['rouble', 'RUB'], ['roubles', 'RUB'],
      ['sterling', 'GBP'],
      ['rmb', 'CNY'], ['renminbi', 'CNY'],
      ['reais', 'BRL'],
      ['hryvnia', 'UAH'], ['hry', 'UAH'],
    ] as [string, string][]) {
      if (!map.has(alias)) map.set(alias, code);
    }
    return map;
  })();

  function resolveCurrencyCode(token: string): string | null {
    const normalized = token.trim().toLowerCase();
    if (!normalized) return null;

    const fromAlias = CURRENCY_ALIASES.get(normalized);
    if (fromAlias) return fromAlias;

    const upper = normalized.toUpperCase();
    return CURRENCY_BY_CODE.has(upper) ? upper : null;
  }

  function normalizeQuery(q: string): string {
    const m = q.match(/^([\d,.]+)\s+([a-zÀ-ÿ]+)$|^([a-zÀ-ÿ]+)\s+([\d,.]+)$/i);
    if (!m) return q;
    const [amount, word] = m[1] ? [m[1], m[2]] : [m[4], m[3]];
    const code = resolveCurrencyCode(word);
    return code ? `${amount} ${code}` : q;
  }

  function parseTargetedConversionQuery(q: string): TargetedConversionQuery | null {
    const tokens = q.trim().split(/\s+/).filter(Boolean);
    if (tokens.length !== 3) return null;

    const amountIndex = tokens.findIndex((token) => /^[\d,.]+$/.test(token));
    if (amountIndex === -1) return null;

    const amountToken = tokens[amountIndex];
    const currencyTokens = tokens.filter((_, index) => index !== amountIndex);
    const sourceCode = resolveCurrencyCode(currencyTokens[0]);
    const targetCode = resolveCurrencyCode(currencyTokens[1]);
    if (!sourceCode || !targetCode || sourceCode === targetCode) return null;

    const source =
      detectPriceFromText(`${amountToken} ${sourceCode}`) ??
      detectPriceFromText(`${sourceCode} ${amountToken}`);

    return source ? { source, targetCode } : null;
  }

  let selectedCodes = $state<string[]>(DEFAULT_CURRENCIES);
  let rates = $state<Record<string, number> | null>(null);
  let searchQuery = $state('');

  let err = $state('');

  function storageGet(keys: string[]): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (r) => resolve(r ?? {}));
    });
  }

  function storageSet(data: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  }

  onMount(async () => {
    try {
      const r = await storageGet([STORAGE.CURRENCIES, STORAGE.RATES]);
      if (r[STORAGE.CURRENCIES]) selectedCodes = r[STORAGE.CURRENCIES] as string[];
      if (r[STORAGE.RATES]) rates = r[STORAGE.RATES] as Record<string, number>;
    } catch (e) { err = `load: ${e}`; }
  });

  async function save(): Promise<void> {
    try {
      await storageSet({ [STORAGE.CURRENCIES]: [...selectedCodes] });
    } catch (e) { err = `save: ${e}`; }
  }

  async function toggleCurrency(code: string): Promise<void> {
    selectedCodes = selectedCodes.includes(code)
      ? selectedCodes.filter((c) => c !== code)
      : [...selectedCodes, code];
    await save();
  }

  const targetedConversion = $derived.by(() => parseTargetedConversionQuery(searchQuery));

  // Detect if search is a price expression → calculator mode
  const parsed = $derived.by(() => {
    const q = searchQuery.trim();
    return targetedConversion?.source ?? detectPriceFromText(q) ?? detectPriceFromText(normalizeQuery(q));
  });
  const isCalcMode = $derived(parsed !== null);

  // Calc mode: all currencies. Search mode: filter by text. Default: all.
  const visibleCurrencies = $derived.by(() => {
    if (targetedConversion) {
      const currency = CURRENCY_BY_CODE.get(targetedConversion.targetCode);
      return currency ? [currency] : [];
    }

    if (!isCalcMode && searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      return CURRENCIES.filter(c =>
        c.code.toLowerCase().includes(query) ||
        c.name.toLowerCase().includes(query)
      );
    }

    return CURRENCIES;
  });

  // Precomputed conversion map: code → formatted string (all currencies in calc mode)
  const conversionMap = $derived.by(() => {
    const map = new Map<string, string>();
    if (!parsed || !rates) return map;
    const sourceRate = rates[parsed.currencyCode];
    if (!sourceRate) return map;

    const targetCodes = targetedConversion
      ? [targetedConversion.targetCode]
      : CURRENCIES.map(({ code }) => code);

    for (const code of targetCodes) {
      if (code === parsed.currencyCode) continue;
      const targetRate = rates[code];
      const currency = CURRENCY_BY_CODE.get(code);
      if (!targetRate || !currency) continue;
      const amount = parsed.amount * (targetRate / sourceRate);
      map.set(code, formatCurrencyAmount(amount, code));
    }
    return map;
  });
</script>

<div class="popup">
  <header class="header">
    <span class="title">PriceHover</span>
    <span class="version">v1.2.3</span>
    <span class="count">{selectedCodes.length} selected</span>
  </header>

  <div class="search-wrap">
    <input
      type="search"
      class="search"
      placeholder="Search or type a price…"
      aria-label="Search currencies"
      bind:value={searchQuery}
    />
  </div>

  <ul class="list">
    {#each visibleCurrencies as currency (currency.code)}
      {@const selected = selectedCodes.includes(currency.code)}
      {@const converted = conversionMap.get(currency.code)}
      <li>
        <label class="row" class:selected={selected && !isCalcMode} class:has-value={!!converted}>
          <input
            type="checkbox"
            class="sr-only"
            checked={selected}
            onchange={() => toggleCurrency(currency.code)}
          />
          <img class="flag" src="https://flagcdn.com/20x15/{flagToCountryCode(currency.flag)}.png" alt="" onerror={(e) => { const t = e.currentTarget as HTMLImageElement; t.style.display = 'none'; (t.nextElementSibling as HTMLElement).style.display = 'inline'; }} /><span class="flag-fb" style="display:none">{currency.flag}</span>
          <span class="code">{currency.code}</span>
          <span class="name">{currency.name}</span>
          <span class="right">
            {#if isCalcMode}
              {#if converted}
                <span class="amount">{converted}</span>
              {:else if !selected}
                <!-- unselected in calc mode: nothing -->
              {:else}
                <span class="loading">…</span>
              {/if}
            {:else if selected}
              <span class="check">✓</span>
            {/if}
          </span>
        </label>
      </li>
    {/each}
    {#if visibleCurrencies.length === 0}
      <li class="empty">No results</li>
    {/if}
  </ul>
  {#if err}<div class="err">{err}</div>{/if}
</div>

<style>
  :global(*) { box-sizing: border-box; margin: 0; padding: 0; }

  :global(:root) {
    --bg: #ffffff;
    --bg2: #f5f5f5;
    --bg3: #ebebeb;
    --fg: #111111;
    --fg2: #666666;
    --accent: #000000;
    --border: #e0e0e0;
    --green: #1a8c2a;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #111111;
      --bg2: #1c1c1c;
      --bg3: #272727;
      --fg: #f0f0f0;
      --fg2: #888888;
      --accent: #ffffff;
      --border: #2a2a2a;
      --green: #5fcc6f;
    }
  }

  .popup {
    width: 320px;
    max-height: 380px;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 13px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 9px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .title { font-weight: 700; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase; }
  .version { font-size: 10px; color: var(--fg2); font-weight: 400; margin-right: auto; margin-left: 6px; }
  .count { font-size: 11px; color: var(--fg2); }

  .search-wrap {
    padding: 7px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .search {
    width: 100%;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 5px 8px;
    color: var(--fg);
    font-size: 12px;
    outline: none;
  }
  .search:focus { border-color: var(--accent); }
  .search::placeholder { color: var(--fg2); }
  .search::-webkit-search-cancel-button { -webkit-appearance: none; }

  .list {
    flex: 1;
    overflow-y: auto;
    list-style: none;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .row {
    display: grid;
    grid-template-columns: 22px 38px 1fr auto;
    align-items: center;
    gap: 0 8px;
    padding: 6px 14px;
    cursor: pointer;
    user-select: none;
    transition: background 0.08s;
  }
  .row:hover { background: var(--bg2); }
  .row.selected { background: var(--bg3); }
  .row.has-value { background: var(--bg2); }

  .flag { width: 20px; height: 15px; object-fit: cover; border-radius: 2px; flex-shrink: 0; }
  .flag-fb { font-size: 14px; line-height: 1; }
  .code { font-weight: 600; font-size: 12px; }
  .name { color: var(--fg2); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .right { text-align: right; min-width: 0; }
  .check { font-size: 11px; font-weight: 700; color: var(--accent); }
  .amount { font-size: 12px; font-weight: 600; color: var(--green); white-space: nowrap; }
  .loading { font-size: 11px; color: var(--fg2); }

  .empty { padding: 14px; color: var(--fg2); font-size: 12px; }
  .err { padding: 4px 14px; font-size: 10px; color: #c0392b; border-top: 1px solid var(--border); font-family: monospace; }


  .sr-only {
    position: absolute; width: 1px; height: 1px;
    padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0,0,0,0); white-space: nowrap; border: 0;
  }
</style>
