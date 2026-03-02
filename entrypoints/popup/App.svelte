<script lang="ts">
  import { onMount } from 'svelte';
  import { CURRENCIES, CURRENCY_BY_CODE } from '../../src/currencies';
  import { STORAGE, DEFAULT_CURRENCIES } from '../../src/types';
  import { detectPriceFromText } from '../../src/detector';

  let selectedCodes = $state<string[]>(DEFAULT_CURRENCIES);
  let rates = $state<Record<string, number> | null>(null);
  let searchQuery = $state('');

  async function storageSet(data: Record<string, unknown>): Promise<void> {
    try { await chrome.storage.sync.set(data); } catch {}
    try { await chrome.storage.local.set(data); } catch {}
  }

  async function storageGet(): Promise<Record<string, unknown>> {
    const keys = [STORAGE.CURRENCIES];
    try {
      const r = await chrome.storage.sync.get(keys);
      if (r[STORAGE.CURRENCIES] !== undefined) return r;
    } catch {}
    try { return await chrome.storage.local.get(keys); } catch {}
    return {};
  }

  onMount(async () => {
    const result = await storageGet();
    if (result[STORAGE.CURRENCIES]) selectedCodes = result[STORAGE.CURRENCIES] as string[];
    try {
      const r = await chrome.runtime.sendMessage({ type: 'getRates' });
      if (r?.rates) rates = r.rates;
    } catch {}
  });

  async function toggleCurrency(code: string): Promise<void> {
    selectedCodes = selectedCodes.includes(code)
      ? selectedCodes.filter((c) => c !== code)
      : [...selectedCodes, code];
    await storageSet({ [STORAGE.CURRENCIES]: selectedCodes });
  }

  // --- Hybrid search / calculator ---

  const parsed = $derived(detectPriceFromText(searchQuery.trim()));
  const isCalcMode = $derived(parsed !== null && rates !== null);

  const calcResults = $derived.by(() => {
    if (!parsed || !rates) return [];
    const sourceRate = rates[parsed.currencyCode];
    if (!sourceRate) return [];
    return selectedCodes
      .filter(code => code !== parsed.currencyCode)
      .flatMap(code => {
        const targetRate = rates![code];
        const currency = CURRENCY_BY_CODE.get(code);
        if (!targetRate || !currency) return [];
        const amount = parsed.amount * (targetRate / sourceRate);
        let formatted: string;
        try {
          formatted = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: code,
            maximumFractionDigits: code === 'JPY' || code === 'KRW' ? 0 : 2,
          }).format(amount);
        } catch {
          formatted = `${amount.toFixed(2)} ${code}`;
        }
        return [{ code, flag: currency.flag, formatted }];
      });
  });

  const filteredCurrencies = $derived(
    (!isCalcMode && searchQuery.trim())
      ? CURRENCIES.filter(c =>
          c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : CURRENCIES
  );

  function formatSource(amount: number, code: string): string {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        maximumFractionDigits: code === 'JPY' || code === 'KRW' ? 0 : 2,
      }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${code}`;
    }
  }
</script>

<div class="popup">
  <header class="header">
    <span class="title">PriceHover</span>
    <span class="count">{selectedCodes.length} selected</span>
  </header>

  <div class="search-wrap">
    <input
      type="search"
      class="search"
      placeholder="Search or type a price…"
      bind:value={searchQuery}
    />
  </div>

  {#if isCalcMode}
    <div class="calc-source">
      {formatSource(parsed!.amount, parsed!.currencyCode)}
    </div>
    {#if calcResults.length > 0}
      <ul class="calc-list">
        {#each calcResults as r (r.code)}
          <li class="calc-item">
            <span class="calc-flag">{r.flag}</span>
            <span class="calc-code">{r.code}</span>
            <span class="calc-amount">{r.formatted}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">No currencies selected</p>
    {/if}
  {:else}
    <ul class="list">
      {#each filteredCurrencies as currency (currency.code)}
        {@const selected = selectedCodes.includes(currency.code)}
        <li>
          <label class="row" class:selected>
            <input
              type="checkbox"
              class="sr-only"
              checked={selected}
              onchange={() => toggleCurrency(currency.code)}
            />
            <span class="code">{currency.code}</span>
            <span class="name">{currency.name}</span>
            {#if selected}<span class="check">✓</span>{/if}
          </label>
        </li>
      {/each}
      {#if filteredCurrencies.length === 0}
        <li class="empty">No results</li>
      {/if}
    </ul>
  {/if}
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
    width: max-content;
    min-width: 220px;
    max-width: 340px;
    max-height: 480px;
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
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--border);
  }
  .title { font-weight: 700; font-size: 13px; letter-spacing: 0.03em; text-transform: uppercase; }
  .count { font-size: 11px; color: var(--fg2); }

  .search-wrap {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
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

  /* --- Calculator mode --- */
  .calc-source {
    padding: 10px 14px 8px;
    font-size: 15px;
    font-weight: 700;
    border-bottom: 1px solid var(--border);
  }

  .calc-list {
    flex: 1;
    overflow-y: auto;
    list-style: none;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .calc-item {
    display: grid;
    grid-template-columns: 20px 38px 1fr;
    align-items: center;
    gap: 0 8px;
    padding: 6px 14px;
  }
  .calc-item:hover { background: var(--bg2); }

  .calc-flag { font-size: 13px; }
  .calc-code { font-size: 12px; font-weight: 600; }
  .calc-amount { font-size: 12px; color: var(--green); font-weight: 600; text-align: right; }

  /* --- Currency list mode --- */
  .list {
    flex: 1;
    overflow-y: auto;
    list-style: none;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .row {
    display: grid;
    grid-template-columns: 38px 1fr 14px;
    align-items: center;
    gap: 0 8px;
    padding: 7px 14px;
    cursor: pointer;
    user-select: none;
    transition: background 0.08s;
  }
  .row:hover { background: var(--bg2); }
  .row.selected { background: var(--bg3); }

  .code { font-weight: 600; font-size: 12px; }
  .name { color: var(--fg2); font-size: 12px; white-space: nowrap; }
  .check { font-size: 11px; font-weight: 700; color: var(--accent); text-align: right; }

  .empty { padding: 16px 14px; color: var(--fg2); font-size: 12px; }

  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden;
    clip: rect(0,0,0,0);
    white-space: nowrap;
    border: 0;
  }
</style>
