<script lang="ts">
  import { flagToCountryCode } from './currencies';
  // Statically imported on purpose. Splitting the flags into a lazily fetched
  // chunk would need `web_accessible_resources`, which lets any page probe for
  // the extension — a worse trade than 12 kB of base64 in the bundle.
  import { flagImage } from './flags';
  import { formatCurrencyAmount, formatCurrencyRange } from './formatter';
  import { t } from './i18n';
  import { MESSAGE, send } from './messages';
  import { registerCard, tooltipState } from './tooltip-state';

  interface Row {
    code: string;
    flag: string;
    flagSrc: string;
    amounts: string[];
    isBase: boolean;
  }

  // Pivot allConversions (one array per hovered price) into one row per target
  // currency. Insertion order is the settings order, base currency first.
  const rows = $derived.by((): Row[] => {
    const { allConversions } = $tooltipState;
    const map = new Map<string, Row>();
    for (const convList of allConversions) {
      for (const [index, conv] of convList.entries()) {
        let row = map.get(conv.currency.code);
        if (!row) {
          row = {
            code: conv.currency.code,
            flag: conv.currency.flag,
            flagSrc: flagImage(flagToCountryCode(conv.currency.flag)),
            amounts: [],
            isBase: index === 0,
          };
          map.set(conv.currency.code, row);
        }
        row.amounts.push(conv.formattedMax ? `${conv.formatted} – ${conv.formattedMax}` : conv.formatted);
      }
    }
    return [...map.values()];
  });

  const sourceLabel = $derived.by(() => {
    const { sources, rounding } = $tooltipState;
    return sources
      .map((s) =>
        s.amountMax === undefined
          ? formatCurrencyAmount(s.amount, s.currencyCode, rounding)
          : formatCurrencyRange(s.amount, s.amountMax, s.currencyCode, rounding)
      )
      .join(' · ');
  });

  const inferred = $derived($tooltipState.sources.some((s) => s.inferred));

  const MARGIN = 8;
  const GAP = 8;

  let cardEl: HTMLElement | undefined = $state();
  let copied = $state('');
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Card size, remembered per layout signature. Measuring is a forced layout,
   * and it used to happen on every single reposition; the card's size only
   * actually changes when the number of rows or the notices do.
   */
  const SIZE_CACHE = new Map<string, { width: number; height: number }>();

  $effect(() => {
    registerCard(cardEl ?? null);
    return () => registerCard(null);
  });

  $effect(() => {
    const { visible, x, y, yBottom } = $tooltipState;
    if (!visible || !cardEl) return;

    const signature = `${rows.length}|${rows[0]?.amounts.length ?? 0}|${inferred}|${$tooltipState.stale}|${copied ? 1 : 0}`;
    let size = SIZE_CACHE.get(signature);
    if (!size) {
      const measured = cardEl.getBoundingClientRect();
      size = { width: measured.width, height: measured.height };
      SIZE_CACHE.set(signature, size);
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const halfWidth = size.width / 2;
    let left = x;
    if (left - halfWidth < MARGIN) left = halfWidth + MARGIN;
    else if (left + halfWidth > vw - MARGIN) left = vw - halfWidth - MARGIN;

    // Above when it fits, below when it does not. The old code only ever asked
    // the first question, so a tall card near the top flipped down and clipped
    // off the bottom instead.
    const fitsAbove = y - GAP - size.height >= MARGIN;
    const fitsBelow = yBottom + GAP + size.height <= vh - MARGIN;
    const above = fitsAbove || (!fitsBelow && y > vh - yBottom);

    cardEl.style.left = `${left}px`;
    cardEl.style.top = `${above ? y : yBottom}px`;
    cardEl.style.transform = above
      ? `translate(-50%, calc(-100% - ${GAP}px))`
      : `translate(-50%, ${GAP}px)`;
    cardEl.style.animationName = above ? 'ph-in' : 'ph-in-below';
  });

  /**
   * The synchronous route, tried first.
   *
   * A content script runs in the page's permission context, and
   * `navigator.clipboard.writeText` there can neither resolve nor reject — it
   * simply hangs, which is what it did throughout testing. A hung promise the
   * handler awaits means the user clicks and nothing ever happens, with no
   * error anywhere. `execCommand` is deprecated and dependable; it is only
   * asked for what it can answer synchronously.
   */
  function copyViaSelection(text: string): boolean {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(scratch);

    const previous = document.activeElement as HTMLElement | null;
    scratch.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    scratch.remove();
    previous?.focus?.();
    return ok;
  }

  async function copyRow(row: Row): Promise<void> {
    const text = row.amounts.join(' · ');
    let ok = copyViaSelection(text);

    if (!ok && navigator.clipboard) {
      ok = await Promise.race([
        navigator.clipboard.writeText(text).then(() => true, () => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
      ]);
    }
    // Saying "Copied" when nothing was copied is worse than saying nothing.
    if (!ok) return;

    copied = row.code;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied = ''; }, 1200);
  }
</script>

{#if $tooltipState.visible}
  <div
    bind:this={cardEl}
    class="ph-card"
    style="left:{$tooltipState.x}px;top:{$tooltipState.y}px"
    role="tooltip"
    aria-live="polite"
  >
    <div class="ph-header">
      <span class="ph-source">{sourceLabel}</span>
    </div>

    <div class="ph-divider"></div>

    {#if rows.length > 0}
      <ul class="ph-list">
        {#each rows as row (row.code)}
          <li>
            <button
              class="ph-item"
              class:ph-base={row.isBase}
              type="button"
              onclick={() => copyRow(row)}
              title={t('tooltipCopyHint')}
            >
              {#if row.flagSrc}
                <img class="ph-flag" src={row.flagSrc} alt="" />
              {:else}
                <span class="ph-flag-fb">{row.flag}</span>
              {/if}
              <span class="ph-item-code">{row.code}</span>
              <span class="ph-item-amounts">
                {#each row.amounts as amount}
                  <span class="ph-item-amount">{amount}</span>
                {/each}
              </span>
              {#if copied === row.code}
                <span class="ph-copied">{t('tooltipCopied')}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="ph-empty">{t('tooltipNoCurrencies')}</p>
      <button class="ph-action" type="button" onclick={() => send(MESSAGE.OPEN_OPTIONS)}>
        {t('tooltipChooseCurrencies')}
      </button>
    {/if}

    {#if inferred}
      <p class="ph-note">{t('tooltipInferred')}</p>
    {/if}
    {#if $tooltipState.stale}
      <p class="ph-note ph-warn">{t('ratesStale')}</p>
    {/if}
  </div>
{/if}
