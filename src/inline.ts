import { convertPrice } from './convert';
import { detectAllFromText } from './detector';
import type { TokenResolver } from './locale';
import type { Settings } from './settings';
import type { ExchangeRates } from './types';

/**
 * Inline mode writes into the page instead of waiting for a hover. That is a
 * different risk profile from a tooltip in a shadow root, so the rules are
 * strict: never replace the site's own text, only append beside it; never touch
 * anything editable or machine-read; and stop after a fixed budget rather than
 * grinding through a 50 000-node page.
 *
 * "Append, never rewrite" covers the node itself, not only its characters: a
 * framework hands out references to the Text nodes it rendered, so splitting or
 * merging one is as destructive as overwriting its text. Nothing here calls
 * `splitText` or `normalize`.
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
  resolver: () => TokenResolver | undefined;
}

interface Annotator {
  scan(root: Node): void;
  refresh(): void;
  destroy(): void;
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
    for (const badge of inserted) if (!badge.isConnected) inserted.delete(badge);
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

    const resolve = deps.resolver();
    const base = settings.baseCurrency;
    let processed = 0;

    while (processed < CHUNK && withinBudget()) {
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
      const price = detectAllFromText(text, resolve).find(
        (p) => p.currencyCode !== base && p.matchEnd !== undefined && !text.slice(p.matchEnd).trim(),
      );
      if (!price) continue;

      const [converted] = convertPrice(price, rates, [base], settings.rounding);
      if (!converted) continue;
      annotate(node, converted.formattedMax
        ? `${converted.formatted} – ${converted.formattedMax}`
        : converted.formatted);
    }

    if (!withinBudget()) resetQueue();
  }

  function annotate(node: Text, label: string): void {
    const parent = node.parentNode;
    if (!parent) return;

    const badge = document.createElement('span');
    badge.setAttribute(INLINE_ATTR, '1');
    // The badge is decoration over the page's own text: it has no business in a
    // copied selection, in find-in-page, or in what a screen reader announces.
    badge.setAttribute('aria-hidden', 'true');
    // Inline styles rather than a stylesheet: this element lives in the page,
    // and a page stylesheet would be free to restyle a class of ours.
    badge.style.cssText =
      'all:unset;font:inherit;font-size:0.85em;opacity:0.75;' +
      'white-space:nowrap;unicode-bidi:isolate;margin-inline-start:0.35em;' +
      'user-select:none;-webkit-user-select:none;';
    badge.textContent = `(${label})`;
    parent.insertBefore(badge, node.nextSibling);
    inserted.add(badge);

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
      badge.remove();
    }
    nodeBadges.delete(node);
  }

  function clear(): void {
    for (const badge of inserted) badge.remove();
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
