<script lang="ts">
  import { onMount } from 'svelte';
  import { CURRENCIES } from '../../src/currencies';
  import { STORAGE, DEFAULT_CURRENCIES } from '../../src/types';

  let selectedCodes = $state<string[]>(DEFAULT_CURRENCIES);
  let excludedCodes = $state<string[]>([]);
  let searchQuery = $state('');

  const filteredCurrencies = $derived(
    searchQuery.trim()
      ? CURRENCIES.filter(
          (c) =>
            c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : CURRENCIES
  );

  async function storageSet(data: Record<string, unknown>): Promise<void> {
    try { await chrome.storage.sync.set(data); } catch {}
    try { await chrome.storage.local.set(data); } catch {}
  }

  async function storageGet(): Promise<Record<string, unknown>> {
    const keys = [STORAGE.CURRENCIES, STORAGE.EXCLUDED];
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
    if (result[STORAGE.EXCLUDED]) excludedCodes = result[STORAGE.EXCLUDED] as string[];
  });

  async function toggleInclude(code: string): Promise<void> {
    selectedCodes = selectedCodes.includes(code)
      ? selectedCodes.filter((c) => c !== code)
      : [...selectedCodes, code];
    await storageSet({ [STORAGE.CURRENCIES]: selectedCodes, [STORAGE.EXCLUDED]: excludedCodes });
  }

  async function toggleExclude(code: string): Promise<void> {
    excludedCodes = excludedCodes.includes(code)
      ? excludedCodes.filter((c) => c !== code)
      : [...excludedCodes, code];
    await storageSet({ [STORAGE.CURRENCIES]: selectedCodes, [STORAGE.EXCLUDED]: excludedCodes });
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
      placeholder="Search…"
      bind:value={searchQuery}
    />
  </div>

  <div class="col-labels">
    <span></span>
    <span></span>
    <span class="col-label">show</span>
    <span class="col-label">mute</span>
  </div>

  <ul class="list">
    {#each filteredCurrencies as currency (currency.code)}
      {@const included = selectedCodes.includes(currency.code)}
      {@const excluded = excludedCodes.includes(currency.code)}
      <li class="row" class:included class:excluded>
        <span class="code">{currency.code}</span>
        <span class="name">{currency.name}</span>
        <button
          class="btn-check"
          class:active={included}
          onclick={() => toggleInclude(currency.code)}
          title="Show in conversions"
        >✓</button>
        <button
          class="btn-mute"
          class:active={excluded}
          onclick={() => toggleExclude(currency.code)}
          title="Suppress tooltip when source is this currency"
        >✕</button>
      </li>
    {/each}
    {#if filteredCurrencies.length === 0}
      <li class="empty">No results</li>
    {/if}
  </ul>
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
    --red: #c0392b;
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
      --red: #e05c5c;
    }
  }

  .popup {
    width: max-content;
    min-width: 240px;
    max-width: 340px;
    max-height: 500px;
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

  .col-labels {
    display: grid;
    grid-template-columns: 38px 1fr 28px 28px;
    gap: 0 4px;
    padding: 4px 14px 2px;
    border-bottom: 1px solid var(--border);
  }
  .col-label {
    font-size: 10px;
    color: var(--fg2);
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .list {
    flex: 1;
    overflow-y: auto;
    list-style: none;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .row {
    display: grid;
    grid-template-columns: 38px 1fr 28px 28px;
    align-items: center;
    gap: 0 4px;
    padding: 5px 14px;
    transition: background 0.08s;
  }
  .row:hover { background: var(--bg2); }

  .code { font-weight: 600; font-size: 12px; }
  .name { color: var(--fg2); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .btn-check,
  .btn-mute {
    width: 22px;
    height: 22px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: none;
    cursor: pointer;
    font-size: 11px;
    font-weight: 700;
    color: var(--fg2);
    display: flex;
    align-items: center;
    justify-content: center;
    justify-self: center;
    transition: background 0.08s, color 0.08s, border-color 0.08s;
  }

  .btn-check.active {
    background: var(--green);
    border-color: var(--green);
    color: #fff;
  }
  .btn-mute.active {
    background: var(--red);
    border-color: var(--red);
    color: #fff;
  }

  .btn-check:hover:not(.active) { border-color: var(--green); color: var(--green); }
  .btn-mute:hover:not(.active)  { border-color: var(--red);   color: var(--red); }

  .empty { padding: 16px 14px; color: var(--fg2); font-size: 12px; }
</style>
