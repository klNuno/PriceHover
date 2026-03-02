<script lang="ts">
  import { onMount } from 'svelte';
  import { CURRENCIES } from '../../src/currencies';
  import { STORAGE, DEFAULT_CURRENCIES } from '../../src/types';

  let selectedCodes = $state<string[]>(DEFAULT_CURRENCIES);
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

  // storage.sync requires a permanent addon ID in Firefox dev mode — fall back to local
  async function storageGet(): Promise<Record<string, unknown>> {
    try { return await chrome.storage.sync.get([STORAGE.CURRENCIES]); } catch {}
    try { return await chrome.storage.local.get([STORAGE.CURRENCIES]); } catch {}
    return {};
  }
  async function storageSet(data: Record<string, unknown>): Promise<void> {
    try { await chrome.storage.sync.set(data); return; } catch {}
    try { await chrome.storage.local.set(data); } catch {}
  }

  onMount(async () => {
    const result = await storageGet();
    if (result[STORAGE.CURRENCIES]) selectedCodes = result[STORAGE.CURRENCIES] as string[];
  });

  function isSelected(code: string): boolean {
    return selectedCodes.includes(code);
  }

  async function toggleCurrency(code: string): Promise<void> {
    selectedCodes = isSelected(code)
      ? selectedCodes.filter((c) => c !== code)
      : [...selectedCodes, code];
    await storageSet({ [STORAGE.CURRENCIES]: selectedCodes });
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

  <ul class="list">
    {#each filteredCurrencies as currency (currency.code)}
      {@const selected = isSelected(currency.code)}
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
    }
  }

  .popup {
    width: 260px;
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

  .title {
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .count {
    font-size: 11px;
    color: var(--fg2);
  }

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

  .search:focus {
    border-color: var(--accent);
  }

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
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px;
    cursor: pointer;
    user-select: none;
    transition: background 0.08s;
  }

  .row:hover { background: var(--bg2); }
  .row.selected { background: var(--bg3); }

  .code {
    font-weight: 600;
    font-size: 12px;
    width: 36px;
    flex-shrink: 0;
  }

  .name {
    flex: 1;
    color: var(--fg2);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .check {
    font-size: 11px;
    font-weight: 700;
    color: var(--accent);
    flex-shrink: 0;
  }

  .empty {
    padding: 16px 14px;
    color: var(--fg2);
    font-size: 12px;
  }

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
