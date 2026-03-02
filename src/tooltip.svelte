<script lang="ts">
  import type { ConvertedPrice, DetectedPrice } from './types';

  interface Props {
    source: DetectedPrice;
    conversions: ConvertedPrice[];
    x: number;
    y: number;
  }

  let { source, conversions, x, y }: Props = $props();

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
</script>

<div
  class="ph-card"
  style="left:{x}px;top:{y}px"
  role="tooltip"
>
  <div class="ph-header">
    <span class="ph-source">{formatAmount(source.amount, source.currencyCode)}</span>
  </div>

  {#if conversions.length > 0}
    <div class="ph-divider"></div>
    <ul class="ph-list">
      {#each conversions as conv (conv.currency.code)}
        <li class="ph-item">
          <span class="ph-item-amount">{conv.formatted}</span>
          <span class="ph-item-code">{conv.currency.code}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="ph-divider"></div>
    <p class="ph-empty">No currencies selected</p>
  {/if}
</div>
