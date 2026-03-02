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

  // Write to both sync and local so either read path finds data.
  async function storageSet(data: Record<string, unknown>): Promise<void> {
    try { await chrome.storage.sync.set(data); } catch {}
    try { await chrome.storage.local.set(data); } catch {}
  }

  // Try sync first; if empty, fall back to local (handles Firefox dev mode
  // where sync.set fails silently and data ends up only in local).
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

  function getState(code: string): 'included' | 'excluded' | 'none' {
    if (selectedCodes.includes(code)) return 'included';
    if (excludedCodes.includes(code)) return 'excluded';
    return 'none';
  }

  async function toggleCurrency(code: string): Promise<void> {
    const state = getState(code);
    if (state === 'none') {
      selectedCodes = [...selectedCodes, code];
    } else if (state === 'included') {
      selectedCodes = selectedCodes.filter((c) => c !== code);
      excludedCodes = [...excludedCodes, code];
    } else {
      excludedCodes = excludedCodes.filter((c) => c !== code);
    }
    await storageSet({
      [STORAGE.CURRENCIES]: selectedCodes,
      [STORAGE.EXCLUDED]: excludedCodes,
    });
  }
</script>

<div class="popup">
  <header class="header">
    <span class="title">PriceHover</span>
    <span class="count">
      {selectedCodes.length} incl{#if excludedCodes.length} · {excludedCodes.length} excl{/if}
    </span>
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
      {@const state = getState(currency.code)}
      <li>
        <label class="row" class:included={state === 'included'} class:excluded={state === 'excluded'}>
          <input
            type="checkbox"
            class="sr-only"
            onchange={() => toggleCurrency(currency.code)}
          />
          <span class="code">{currency.code}</span>
          <span class="name">{currency.name}</span>
          {#if state === 'included'}
            <span class="indicator check">✓</span>
          {:else if state === 'excluded'}
            <span class="indicator cross">✕</span>
          {:else}
            <span class="indicator"></span>
          {/if}
        </label>
      </li>
    {/each}
    {#if filteredCurrencies.length === 0}
      <li class="empty">No results</li>
    {/if}
  </ul>

  <div class="legend">
    <span>click: include</span>
    <span class="sep">·</span>
    <span>click again: exclude</span>
    <span class="sep">·</span>
    <span>once more: reset</span>
  </div>
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
    --bg-incl: #f0faf0;
    --bg-excl: #fdf2f2;
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
      --bg-incl: #152015;
      --bg-excl: #201515;
    }
  }

  .popup {
    width: max-content;
    min-width: 220px;
    max-width: 340px;
    max-height: 520px;
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
    width: 100%;
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
    grid-template-columns: 38px 1fr 16px;
    align-items: center;
    gap: 0 8px;
    padding: 7px 14px;
    cursor: pointer;
    user-select: none;
    transition: background 0.08s;
  }

  .row:hover { background: var(--bg2); }
  .row.included { background: var(--bg-incl); }
  .row.excluded { background: var(--bg-excl); }

  .code {
    font-weight: 600;
    font-size: 12px;
  }

  .name {
    color: var(--fg2);
    font-size: 12px;
    white-space: nowrap;
  }

  .indicator {
    font-size: 11px;
    font-weight: 700;
    text-align: right;
  }

  .check { color: var(--green); }
  .cross { color: var(--red); }

  .legend {
    display: flex;
    gap: 4px;
    padding: 6px 14px;
    border-top: 1px solid var(--border);
    font-size: 10px;
    color: var(--fg2);
  }

  .sep { color: var(--border); }

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
