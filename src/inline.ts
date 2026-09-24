import { convertPrice } from './convert';
import { detectAllFromText } from './detector';
import type { TokenResolver } from './locale';
import type { Settings } from './settings';
import type { ExchangeRates } from './types';

/**
 * Inline mode writes into the page instead of waiting for a hover. That is a
 * different risk profile from a tooltip in a shadow root, so the rules are
 * strict: never touch the site's own text, never touch anything editable or
 * machine-read, and stop after a fixed budget rather than grinding through a
 * 50 000-node page.
 *
 * "Never touch the text" covers the node itself, not only its characters: a
 * framework hands out references to the Text nodes it rendered, so splitting,
 * merging or reparenting one is as destructive as overwriting its text. Nothing
 * here calls `splitText`, `normalize`, or moves a node the page created.
 *

 * The page's layout is the site's too. A badge that would push the text it
 * annotates onto a second line is taken back rather than kept: the hover still
 * answers there, and a table whose every row grew by a line is a page the
 * extension broke. See `place`.
 *
 * `replace` style holds to that too. It does not remove the page's price, it
 * collapses it with a style on the element that holds it, and puts the
 * converted amount next to it. The text node is still there, still says what
 * the site wrote, still reachable by the site's own code; the tooltip shows it
 * on hover; and flipping the setting back restores the element's `style`
 * attribute exactly as it was.
 */

export const INLINE_ATTR = 'data-pricehover';

/** Anything outside this namespace is SVG or MathML, where an HTML span renders nothing. */
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** Containers whose text is code, input, or markup rather than prose. */
const SKIPPED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'CODE', 'PRE', 'KBD', 'SAMP', 'HEAD', 'TITLE',
]);

/** A page with more prices than this is a data table; annotating it helps nobody. */
const MAX_ANNOTATIONS = 600;
/** Text nodes examined per idle slice. */
const CHUNK = 250;
/**
 * Pending work is dropped past this point. An SPA can mutate faster than idle
 * slices drain, and an unbounded queue would hold every detached Text node it
 * ever produced alive.
 */
const MAX_QUEUE = 20000;
/** Consumed slots are dropped once this many pile up behind the cursor. */
const COMPACT_AT = 512;

export interface InlineDeps {
  settings: () => Settings;
  rates: () => ExchangeRates | null;
  /**
   * How `$`, `kr` and `¥` read inside this element. Per element, not per page:
   * the row a price sits in can name its currency (`Chinese Yuan … ¥ 69`).
   */
  resolver: (element: Element | null) => TokenResolver | undefined;
  /** A price was found in a currency the rate table does not price. */
  onUnpriced?: (code: string) => void;
}

interface Annotator {
  scan(root: Node): void;
  refresh(): void;
  destroy(): void;
}

/** What a collapsed element's text looked like, so its badge can look the same. */
interface TextType {
  size: string;
  line: string;
}

/** A badge a slice decided on, held back until the slice can be placed in one go. */
interface Pending {
  node: Text;
  label: string;
  /** Whether the badge stands in for the page's own price rather than following it. */
  collapse: boolean;
}

type IdleHandle = number;

const requestIdle: (cb: () => void) => IdleHandle =
  typeof requestIdleCallback === 'function'
    ? (cb) => requestIdleCallback(() => cb(), { timeout: 500 }) as unknown as IdleHandle
    : (cb) => setTimeout(cb, 16) as unknown as IdleHandle;

const cancelIdle: (handle: IdleHandle) => void =
  typeof cancelIdleCallback === 'function'
    ? (handle) => cancelIdleCallback(handle as unknown as number)
    : (handle) => clearTimeout(handle as unknown as number);

/**
 * How tall an element's own content is, as opposed to how tall its box is. A
 * range over the contents ignores what stretched the box around them, which is
 * what a table row does to every cell in it.
 */
function textHeight(el: HTMLElement | null): number {
  if (!el) return 0;
  const range = document.createRange();
  range.selectNodeContents(el);
  const height = range.getBoundingClientRect().height;
  range.detach();
  return height;
}

function isSkipped(node: Text): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) {
    // tagName is uppercase only in the HTML namespace, so an <svg> reports
    // "svg" and would walk straight past the tag list.
    if (el.namespaceURI !== XHTML_NS) return true;
    if (SKIPPED_TAGS.has(el.tagName)) return true;
    if (el.hasAttribute(INLINE_ATTR)) return true;
    if (el.isContentEditable) return true;
  }
  return false;
}

export function createInlineAnnotator(deps: InlineDeps): Annotator {
  const inserted = new Set<HTMLElement>();
  /**
   * Elements whose own text this annotator collapsed, and the `style` attribute
   * they had before. Keyed by the badge that replaced them, so the two are
   * always undone together: a badge the page throws away must not leave an
   * invisible price behind it.
   */
  const collapsed = new Map<HTMLElement, { el: HTMLElement; previous: string | null }>();
  /**
   * Text a node held when it was last annotated. A node reaches the queue more
   * than once (a mutation record and a rescan can both name it) and without
   * this it would collect a second copy of every badge. Unchanged text means
   * there is nothing left to do; changed text means the old badges are wrong
   * and have to come off first.
   */
  let seen = new WeakMap<Text, string>();
  let nodeBadges = new WeakMap<Text, HTMLElement[]>();
  /**
   * Text nodes to examine, mixed with roots still to be expanded. A root is
   * queued whole and walked later, inside an idle slice, so a single mutation
   * carrying half a page does not cost a synchronous full-document walk in the
   * observer's microtask.
   */
  let queue: Node[] = [];
  let cursor = 0;
  let walking: TreeWalker | null = null;
  let idleHandle: IdleHandle | null = null;
  let destroyed = false;

  /**
   * Our own writes have to stay out of the queue, but the buffer they land in
   * also holds the page's pending mutations, so draining it with
   * `takeRecords()` threw away page changes that were never annotated
   * afterwards. Every element we insert carries INLINE_ATTR, so filtering the
   * records is enough, and removals are ignored here in any case.
   */
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute?.(INLINE_ATTR)) continue;
        enqueue(node);
      }
      // A page that re-renders a price container drops our badge with it. In
      // `replace` style that badge is the only thing on screen saying what the
      // price is, so the element it hid has to be given its text back.
      for (const node of record.removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const badge = node as HTMLElement;
        if (collapsed.has(badge)) restoreCollapsed(badge);
      }
      if (record.type === 'characterData' && record.target.nodeType === Node.TEXT_NODE) {
        enqueue(record.target);
      }
    }
    schedule();
  });

  function enqueue(root: Node): void {
    if (destroyed || !root.isConnected) return;
    if (root.nodeType !== Node.TEXT_NODE && root.nodeType !== Node.ELEMENT_NODE) return;
    if (queue.length - cursor >= MAX_QUEUE) return;
    queue.push(root);
  }

  function resetQueue(): void {
    queue = [];
    cursor = 0;
    walking = null;
  }

  /**
   * Next text node to examine, expanding one queued root at a time. Reading
   * through a cursor rather than `shift()` keeps a full-document refresh linear
   * instead of quadratic; the tail is compacted away once enough of it is dead.
   */
  function nextText(): Text | null {
    for (;;) {
      if (walking) {
        const next = walking.nextNode();
        if (next) return next as Text;
        walking = null;
      }
      if (cursor >= queue.length) { resetQueue(); return null; }

      const item = queue[cursor++]!;
      if (cursor >= COMPACT_AT) { queue = queue.slice(cursor); cursor = 0; }
      if (item.nodeType === Node.TEXT_NODE) return item as Text;
      if (!item.isConnected) continue;
      walking = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    }
  }

  /**
   * A badge whose subtree the page dropped never reaches removeBadgesFor, so
   * the budget would fill with badges nobody can see and annotation would stop
   * for good with an empty screen. Pruning only once the budget looks full
   * keeps the scan off the hot path.
   */
  function withinBudget(): boolean {
    if (inserted.size < MAX_ANNOTATIONS) return true;
    for (const badge of inserted) {
      if (badge.isConnected) continue;
      restoreCollapsed(badge);
      inserted.delete(badge);
    }
    return inserted.size < MAX_ANNOTATIONS;
  }

  function schedule(): void {
    if (destroyed || idleHandle !== null) return;
    if (!walking && cursor >= queue.length) return;
    idleHandle = requestIdle(() => {
      idleHandle = null;
      drain();
      schedule();
    });
  }

  function drain(): void {
    const settings = deps.settings();
    const rates = deps.rates();
    if (!rates) { resetQueue(); return; }

    const base = settings.baseCurrency;
    const replacing = settings.inlineStyle === 'replace';
    const batch: Pending[] = [];
    let processed = 0;

    // The batch counts against the budget too: it is inserted at the end of the
    // slice, and without this a page of prices would overshoot by a whole chunk.
    while (processed < CHUNK && withinBudget() && inserted.size + batch.length < MAX_ANNOTATIONS) {
      const node = nextText();
      if (!node) break;
      processed++;
      if (!node.isConnected || isSkipped(node)) continue;
      if (seen.get(node) === node.data) continue;
      if (seen.has(node)) removeBadgesFor(node);

      const text = node.data;
      seen.set(node, text);
      if (text.length > 400 || !/\d/.test(text)) continue;

      // Only a price with nothing but blanks behind it can be annotated. Any
      // other one would need the node split in two, and a framework holding the
      // original Text node then writes into the head while the orphaned tail
      // stays on screen, which shows the user its text twice. A missing badge
      // is a smaller loss than a broken page.
      const price = detectAllFromText(text, deps.resolver(node.parentElement)).find(
        (p) => p.currencyCode !== base && p.matchEnd !== undefined && !text.slice(p.matchEnd).trim(),
      );
      if (!price) continue;

      const [converted] = convertPrice(price, rates, [base], settings.rounding);
      // A price found and not converted is a rate we do not hold. The caller is
      // the only one that can do anything about it, and it re-runs this pass
      // when it has: crypto is the case that made this necessary.
      if (!converted) { deps.onUnpriced?.(price.currencyCode); continue; }
      const label = converted.formattedMax
        ? `${converted.formatted} – ${converted.formattedMax}`
        : converted.formatted;
      batch.push({ node, label, collapse: replacing && canCollapse(node, text, price.matchStart ?? 0) });
    }

    place(batch);
    if (!withinBudget()) resetQueue();
  }

  /**
   * Inserts a slice of badges, then takes back the ones that pushed the page
   * around. A badge is decoration: it may sit beside a price, it may not cost
   * the site a line. The case that made this necessary is a price table with
   * narrow cells, where every annotated row gained a line and the page grew by
   * a third.
   *
   * Reads, then writes, then reads: two layout passes for the whole slice
   * rather than one per badge. The font size a collapsed element hands its
   * badge is read in the first pass for the same reason.
   *
   * What is measured is the element's own text, not the element: a table cell
   * is as tall as its row, so the cell beside the one that wrapped grew too,
   * and measuring the box would have taken back every badge in the table. The
   * tolerance is half a line, because a badge one font size smaller than the
   * text sits a few pixels below it without wrapping anything.
   */
  function place(batch: Pending[]): void {
    if (!batch.length) return;

    const hosts = batch.map((b) => b.node.parentElement);
    const before = hosts.map(textHeight);
    const styles = hosts.map((el) => (el ? getComputedStyle(el) : null));
    const type = batch.map((b, i) =>
      b.collapse && styles[i]
        ? { size: styles[i]!.fontSize || '1em', line: styles[i]!.lineHeight || 'normal' }
        : null,
    );
    const room = styles.map((s) => {
      if (!s) return Infinity;
      const line = parseFloat(s.lineHeight);
      return (Number.isFinite(line) ? line : parseFloat(s.fontSize) * 1.2) / 2;
    });

    for (const [i, b] of batch.entries()) annotate(b.node, b.label, type[i] ?? null);

    const after = hosts.map(textHeight);
    for (const [i, b] of batch.entries()) {
      // A height of zero is a page that cannot be measured, not a page that
      // stayed put: a detached subtree, a hidden tab, a DOM without layout. The
      // badge stays, since there is no wrap to answer for.
      if (!after[i] || after[i]! <= before[i]! + room[i]!) continue;
      removeBadgesFor(b.node);
    }
  }

  /**
   * Whether the page's own price can be collapsed rather than annotated.
   *
   * Two conditions, and both are about owning the whole line. The element must
   * hold this text node and nothing else, or collapsing it would take a label,
   * a currency symbol in its own span, or a sibling price down with it. And the
   * price must be the entire text, not the tail of it: `Now ¥1980` would leave
   * the word "Now" hidden with nothing standing in for it.
   */
  function canCollapse(node: Text, text: string, matchStart: number): boolean {
    const parent = node.parentElement;
    if (!parent || parent.childNodes.length !== 1) return false;
    return !text.slice(0, matchStart).trim();
  }

  /**
   * Collapses an element's text to nothing without touching the text.
   *
   * `font-size:0` rather than `display:none` on the element: a `<td>` set to
   * `display:none` leaves the table, and every cell to its right shifts one
   * column left. The letter and word spacing go with it because both are
   * per-character widths that survive a zero font size.
   *
   * The type comes from the caller, which read it before any of this slice's
   * writes: the badge lives inside the collapsed element and would otherwise
   * inherit the zero.
   *
   * `line-height:0` goes with the zero font size, and the badge carries the
   * element's real line height instead. Without it the line keeps a strut half
   * a leading tall above and below the baseline, the badge adds its own box on
   * top of that, and every collapsed line came out five pixels taller than the
   * one it replaced: a table gained a fifth of its height on annotation.
   */
  function collapseText(el: HTMLElement, type: TextType): { type: TextType; previous: string | null } {
    const previous = el.getAttribute('style');
    el.style.setProperty('font-size', '0');
    el.style.setProperty('line-height', '0');
    el.style.setProperty('letter-spacing', '0');
    el.style.setProperty('word-spacing', '0');
    return { type, previous };
  }

  function restoreCollapsed(badge: HTMLElement): void {
    const entry = collapsed.get(badge);
    if (!entry) return;
    collapsed.delete(badge);
    if (entry.previous === null) entry.el.removeAttribute('style');
    else entry.el.setAttribute('style', entry.previous);
  }

  function annotate(node: Text, label: string, type: TextType | null): void {
    const parent = node.parentNode;
    if (!parent) return;

    const badge = document.createElement('span');
    badge.setAttribute(INLINE_ATTR, '1');
    // The badge is decoration over the page's own text: it has no business in a
    // copied selection, in find-in-page, or in what a screen reader announces.
    // Replacing is the exception on the last point, since the text it stands in
    // for is the one thing on the line a reader can no longer see.
    if (type === null) badge.setAttribute('aria-hidden', 'true');

    const hidden = type === null ? null : collapseText(node.parentElement!, type);
    // Inline styles rather than a stylesheet: this element lives in the page,
    // and a page stylesheet would be free to restyle a class of ours.
    badge.style.cssText = hidden
      ? `all:unset;font:inherit;font-size:${hidden.type.size};line-height:${hidden.type.line};` +
        'letter-spacing:normal;word-spacing:normal;' +
        'white-space:nowrap;unicode-bidi:isolate;' +
        'user-select:none;-webkit-user-select:none;'
      // The page's own size, not a smaller one: a badge set in 0.85em read as a
      // footnote beside the price it converts, and on a cramped line it was
      // the one thing that did not look like the site.
      : 'all:unset;font:inherit;opacity:0.75;' +
        'white-space:nowrap;unicode-bidi:isolate;margin-inline-start:0.35em;' +
        'user-select:none;-webkit-user-select:none;';
    badge.textContent = hidden ? label : `(${label})`;
    parent.insertBefore(badge, node.nextSibling);
    inserted.add(badge);
    if (hidden) collapsed.set(badge, { el: node.parentElement!, previous: hidden.previous });

    const owned = nodeBadges.get(node);
    if (owned) owned.push(badge);
    else nodeBadges.set(node, [badge]);
  }

  /** Drops the badges a node produced. The node's own text was never touched. */
  function removeBadgesFor(node: Text): void {
    const owned = nodeBadges.get(node);
    if (!owned) return;

    for (const badge of owned) {
      inserted.delete(badge);
      restoreCollapsed(badge);
      badge.remove();
    }
    nodeBadges.delete(node);
  }

  function clear(): void {
    for (const badge of inserted) {
      restoreCollapsed(badge);
      badge.remove();
    }
    inserted.clear();
    seen = new WeakMap();
    nodeBadges = new WeakMap();
  }

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  return {
    scan(root: Node): void {
      enqueue(root);
      schedule();
    },
    refresh(): void {
      clear();
      resetQueue();
      enqueue(document.body);
      schedule();
    },
    destroy(): void {
      destroyed = true;
      observer.disconnect();
      if (idleHandle !== null) { cancelIdle(idleHandle); idleHandle = null; }
      resetQueue();
      clear();
    },
  };
}
