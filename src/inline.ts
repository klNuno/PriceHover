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
 */

export const INLINE_ATTR = 'data-pricehover';

/** Containers whose text is code, input, or markup rather than prose. */
const SKIPPED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'CODE', 'PRE', 'KBD', 'SAMP', 'SVG', 'MATH', 'HEAD', 'TITLE',
]);

/** A page with more prices than this is a data table; annotating it helps nobody. */
const MAX_ANNOTATIONS = 600;
/** Text nodes examined per idle slice. */
const CHUNK = 250;

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
  let queue: Text[] = [];
  let idleHandle: IdleHandle | null = null;
  let writing = false;
  let destroyed = false;

  /**
   * Mutation records are delivered as a microtask, long after `writing` has
   * gone back to false, so the flag alone does not keep our own edits out.
   * `splitText` in particular queues a characterData record on the node we just
   * annotated, which came straight back in and annotated it a second time.
   * Taking and discarding the records while still holding the flag is what
   * actually closes the loop.
   */
  function discardOwnRecords(): void {
    observer.takeRecords();
  }

  const observer = new MutationObserver((records) => {
    if (writing) return;
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
    if (destroyed) return;
    if (root.nodeType === Node.TEXT_NODE) {
      queue.push(root as Text);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) queue.push(node as Text);
  }

  function schedule(): void {
    if (destroyed || idleHandle !== null || !queue.length) return;
    idleHandle = requestIdle(() => {
      idleHandle = null;
      drain();
      schedule();
    });
  }

  function drain(): void {
    const settings = deps.settings();
    const rates = deps.rates();
    if (!rates) { queue = []; return; }

    const resolve = deps.resolver();
    const base = settings.baseCurrency;
    let processed = 0;

    writing = true;
    try {
      while (queue.length && processed < CHUNK && inserted.size < MAX_ANNOTATIONS) {
        const node = queue.shift()!;
        processed++;
        if (!node.isConnected || isSkipped(node)) continue;
        if (seen.get(node) === node.data) continue;
        if (seen.has(node)) removeBadgesFor(node);

        const text = node.data;
        seen.set(node, text);
        if (text.length > 400 || !/\d/.test(text)) continue;

        const prices = detectAllFromText(text, resolve).filter((p) => p.currencyCode !== base);
        if (!prices.length) continue;

        // Right to left: every insertion shifts the offsets after it.
        for (const price of [...prices].reverse()) {
          if (inserted.size >= MAX_ANNOTATIONS) break;
          const [converted] = convertPrice(price, rates, [base], settings.rounding);
          if (!converted) continue;
          annotate(node, price.matchEnd ?? text.length, converted.formattedMax
            ? `${converted.formatted} – ${converted.formattedMax}`
            : converted.formatted);
        }
        // splitText left the node holding only the head of its old text.
        seen.set(node, node.data);
      }
    } finally {
      discardOwnRecords();
      writing = false;
    }

    if (inserted.size >= MAX_ANNOTATIONS) queue = [];
  }

  function annotate(node: Text, offset: number, label: string): void {
    const parent = node.parentNode;
    if (!parent || offset > node.data.length) return;

    const tail = offset < node.data.length ? node.splitText(offset) : node.nextSibling;
    const badge = document.createElement('span');
    badge.setAttribute(INLINE_ATTR, '1');
    // Inline styles rather than a stylesheet: this element lives in the page,
    // and a page stylesheet would be free to restyle a class of ours.
    badge.style.cssText =
      'all:unset;font:inherit;font-size:0.85em;opacity:0.75;' +
      'white-space:nowrap;unicode-bidi:isolate;margin-inline-start:0.35em;';
    badge.textContent = `(${label})`;
    parent.insertBefore(badge, tail);
    inserted.add(badge);

    const owned = nodeBadges.get(node);
    if (owned) owned.push(badge);
    else nodeBadges.set(node, [badge]);
  }

  /** Drops the badges a node produced, and rejoins the text splitText divided. */
  function removeBadgesFor(node: Text): void {
    const owned = nodeBadges.get(node);
    if (!owned) return;

    const parent = node.parentNode;
    for (const badge of owned) {
      inserted.delete(badge);
      badge.remove();
    }
    nodeBadges.delete(node);
    if (parent && parent.nodeType === Node.ELEMENT_NODE) (parent as Element).normalize();
  }

  function clear(): void {
    writing = true;
    for (const badge of inserted) {
      const parent = badge.parentNode;
      badge.remove();
      // splitText left two adjacent text nodes behind; put them back together
      // so a second pass sees the same DOM the first one did.
      if (parent && parent.nodeType === Node.ELEMENT_NODE) (parent as Element).normalize();
    }
    inserted.clear();
    seen = new WeakMap();
    nodeBadges = new WeakMap();
    discardOwnRecords();
    writing = false;
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
      queue = [];
      enqueue(document.body);
      schedule();
    },
    destroy(): void {
      destroyed = true;
      observer.disconnect();
      if (idleHandle !== null) { cancelIdle(idleHandle); idleHandle = null; }
      queue = [];
      clear();
    },
  };
}
