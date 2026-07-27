<script lang="ts">
  import { flagToCountryCode } from './currencies';
  // Statically imported on purpose. Splitting the flags into a lazily fetched
  // chunk would need `web_accessible_resources`, which lets any page probe for
  // the extension, a worse trade than 12 kB of base64 in the bundle.
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
  /** False once the host is gone, so a late clipboard answer stays quiet. */
  let alive = true;

  /**
   * Card size, remembered per layout signature. Measuring is a forced layout,
   * and it used to happen on every single reposition; the card's size only
   * actually changes when the number of rows or the notices do.
   */
  const SIZE_CACHE = new Map<string, { width: number; height: number }>();

  /**
   * The signature now carries the text, so one entry per distinct price is
   * possible and the map would grow for as long as the page lives. It is a
   * measurement cache, not a source of truth: dropping it costs one reflow.
   */
  const SIZE_CACHE_MAX = 64;

  $effect(() => {
    registerCard(cardEl ?? null);
    return () => registerCard(null);
  });

  $effect(() => () => {
    // The 1.2 s reset used to outlive the host and write to a destroyed
    // instance when the page navigated or the extension was switched off.
    alive = false;
    clearTimeout(copiedTimer);
  });

  $effect(() => {
    const { visible, x, y, yBottom } = $tooltipState;
    if (!visible || !cardEl) return;

    // Width comes from the text, not from the row count. Keying on counts alone
    // let `€9` and `≈€1,234,567.89` share an entry, so the flip and clamp below
    // ran on another card's measurement and this one landed off the viewport.
    const shape = rows.map((row) => row.amounts.map((amount) => amount.length).join('.')).join(',');
    const signature = `${shape}|${sourceLabel.length}|${inferred}|${$tooltipState.stale}|${copied ? 1 : 0}`;
    let size = SIZE_CACHE.get(signature);
    if (!size) {
      const measured = cardEl.getBoundingClientRect();
      size = { width: measured.width, height: measured.height };
      if (SIZE_CACHE.size >= SIZE_CACHE_MAX) SIZE_CACHE.clear();
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
   * Where the scratch textarea goes. Never `document.body`: a node holding the
   * converted amount, parked in the page's own DOM, tells the site the user's
   * base currency and rounding preference for as long as it is there.
   */
  function scratchParent(): { parent: Node; host: Element | null } | null {
    if (!cardEl) return null;
    const root = cardEl.getRootNode();
    if (root instanceof ShadowRoot) return { parent: root, host: root.host };
    // No shadow root (a stubbed environment, or an `attachShadow` that failed):
    // the container the component was mounted into is still not the page body.
    // With nowhere of our own to write, the async API runs instead, because the
    // page never gets to hold this text as a fallback.
    return cardEl.parentNode ? { parent: cardEl.parentNode, host: null } : null;
  }

  /**
   * Selecting text is what put the tooltip on screen in the first place, and
   * focusing the scratch textarea collapses that selection. Snapshot before,
   * put it back after.
   */
  function snapshotSelection(): Range | null {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    try { return selection.getRangeAt(0).cloneRange(); } catch { return null; }
  }

  function restoreSelection(range: Range | null): void {
    if (!range) return;
    const selection = document.getSelection();
    if (!selection) return;
    try {
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // The nodes the range pointed at can be gone by now: an SPA re-rendering
      // under a copy is not an error worth surfacing.
    }
  }

  /**
   * The synchronous route, tried first.
   *
   * `execCommand` is deprecated and answers immediately with a boolean this
   * code can act on. `navigator.clipboard.writeText` runs in the page's
   * permission context and was observed neither resolving nor rejecting there,
   * so it is kept only as a fallback, and only raced against a timeout.
   */
  function copyViaSelection(text: string): boolean {
    const target = scratchParent();
    if (!target) return false;
    const { parent, host } = target;
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    // Off-screen, not invisible. A textarea at 1px with `opacity: 0` cannot be
    // reliably selected: the copy silently returned false about half the time.
    // The offset needs no `scrollY` term here: the shadow host is fixed at the
    // viewport origin, so this is already parked outside the viewport.
    scratch.style.cssText =
      'position:absolute;left:-9999px;top:0;' +
      'width:2em;height:2em;padding:0;border:0;margin:0;outline:0;box-shadow:none;background:transparent;';

    // A `copy` event is composed, so it crosses the shadow boundary and reaches
    // the page unless it is stopped here. A page listener that gets it can read
    // the payload, or call `preventDefault()` and write its own text while
    // `execCommand` still answers true, which would make this show "Copied" for
    // something the site chose. A capture listener still runs before this one,
    // so its `preventDefault()` is checked rather than assumed away.
    let hijacked = false;
    scratch.addEventListener('copy', (event) => {
      hijacked = event.defaultPrevented;
      event.stopPropagation();
    });

    parent.appendChild(scratch);

    const range = snapshotSelection();
    // For anything focused inside a closed shadow root `document.activeElement`
    // is retargeted to the host, and the host is a `pointer-events:none` div
    // with no tabindex: focusing it is a no-op that drops focus on `<body>` and
    // loses what the page had (a half-typed search box, an IME composition).
    const active = document.activeElement as HTMLElement | null;
    const previous = active && active !== host ? active : null;

    scratch.focus({ preventScroll: true });
    scratch.setSelectionRange(0, text.length);

    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    scratch.remove();
    previous?.focus?.({ preventScroll: true });
    restoreSelection(range);
    return ok && !hijacked;
  }

  function markCopied(code: string): void {
    if (!alive) return;
    copied = code;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied = ''; }, 1200);
  }

  async function copyRow(row: Row): Promise<void> {
    const text = row.amounts.join(' · ');
    // Read now, not after the await: by then the pointer may have moved to
    // another price and the card may already be showing it.
    const shownFor = sourceLabel;
    const ok = copyViaSelection(text);
    if (ok) {
      markCopied(row.code);
      return;
    }

    if (!navigator.clipboard) return;

    // Raced, never plainly awaited: a clipboard promise that settles neither
    // way is a real state this API gets into, and awaiting one means the user
    // clicks and nothing ever happens: no copy, no error, no console entry.
    const write = navigator.clipboard.writeText(text).then(() => true, () => false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raced = await Promise.race([
      write,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 500); }),
    ]);
    clearTimeout(timer);

    // Saying "Copied" when nothing was copied is worse than saying nothing.
    if (raced === false) return;

    if (raced === true) {
      markCopied(row.code);
      return;
    }

    // Timed out. The write may still land, and reporting nothing for a copy
    // that worked is its own kind of lie, so confirm late instead: only if the
    // write really succeeds, and only while the card still shows the same
    // prices, so the badge cannot appear on an unrelated hover.
    void write.then((late) => {
      if (late && $tooltipState.visible && sourceLabel === shownFor) markCopied(row.code);
    });
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
