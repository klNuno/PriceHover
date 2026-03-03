<script lang="ts">
  import type { ConvertedPrice, DetectedPrice } from './types';
  import { flagToCountryCode } from './currencies';

  interface Props {
    sources: DetectedPrice[];
    allConversions: ConvertedPrice[][];
    x: number;
    y: number;
    yBottom: number;
  }

  let { sources, allConversions, x, y, yBottom }: Props = $props();

  function formatAmount(amount: number, code: string): string {
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

  // Pivot allConversions (per-source arrays) into per-target-currency rows.
  const rows = $derived(() => {
    const map = new Map<string, { flag: string; amounts: string[] }>();
    for (const convList of allConversions) {
      for (const conv of convList) {
        if (!map.has(conv.currency.code)) {
          map.set(conv.currency.code, { flag: conv.currency.flag, amounts: [] });
        }
        map.get(conv.currency.code)!.amounts.push(conv.formatted);
      }
    }
    return [...map.entries()].map(([code, v]) => ({ code, ...v }));
  });

  const MARGIN = 8;
  let cardEl: HTMLElement | undefined = $state();

  $effect(() => {
    if (!cardEl) return;
    const card = cardEl.getBoundingClientRect();
    const vw = window.innerWidth;

    // Horizontal: clamp so tooltip never overflows left or right
    const halfW = card.width / 2;
    let left = x;
    if (left - halfW < MARGIN) left = halfW + MARGIN;
    else if (left + halfW > vw - MARGIN) left = vw - halfW - MARGIN;
    cardEl.style.left = `${left}px`;

    // Vertical: flip below if not enough space above
    if (card.top < MARGIN) {
      cardEl.style.top = `${yBottom}px`;
      cardEl.style.transform = 'translate(-50%, 8px)';
      cardEl.style.animationName = 'ph-in-below';
    }
  });
</script>

<div
  bind:this={cardEl}
  class="ph-card"
  style="left:{x}px;top:{y}px"
  role="tooltip"
>
  <div class="ph-header">
    <span class="ph-source">
      {sources.map(s => formatAmount(s.amount, s.currencyCode)).join(' · ')}
    </span>
  </div>

  {#if rows().length > 0}
    <div class="ph-divider"></div>
    <ul class="ph-list">
      {#each rows() as row (row.code)}
        <li class="ph-item">
          <img
            class="ph-flag"
            src="https://flagcdn.com/20x15/{flagToCountryCode(row.flag)}.png"
            alt=""
            onerror={(e) => { const t = e.currentTarget as HTMLImageElement; t.style.display = 'none'; (t.nextElementSibling as HTMLElement).style.display = ''; }}
          /><span class="ph-flag-fb" style="display:none">{row.flag}</span>
          <span class="ph-item-code">{row.code}</span>
          {#each row.amounts as amt}
            <span class="ph-item-amount">{amt}</span>
          {/each}
        </li>
      {/each}
    </ul>
  {:else}
    <div class="ph-divider"></div>
    <p class="ph-empty">No currencies selected</p>
  {/if}
</div>
