import { writtenCurrencyCounts } from './detector';
import type { FamilyChoice } from './families';
import { rowChoice } from './locale';
import type { PageSignals } from './locale';

/** Where a row starts: a table row, a list item, an ARIA row. */
const ROW_SELECTOR = 'tr, li, [role="row"]';

/**
 * Past this, the "row" is a layout wrapper holding half the page, and a
 * currency named somewhere in it says nothing about the price being read.
 */
const MAX_ROW_TEXT = 600;

/**
 * What the row around an element says about `$`, `kr` and `¥`, or `null` when
 * there is no row or it says nothing. See `rowChoice` for the rules.
 */
export function rowContext(element: Element): { row: Element; choice: FamilyChoice } | null {
  const row = element.closest(ROW_SELECTOR);
  if (!row) return null;
  const text = row.textContent ?? '';
  if (text.length > MAX_ROW_TEXT) return null;
  const choice = rowChoice(text, new Set(writtenCurrencyCounts(text).keys()));
  return Object.keys(choice).length ? { row, choice } : null;
}

const DECLARED_SELECTOR =
  'meta[property="og:price:currency"], meta[property="product:price:currency"], [itemprop="priceCurrency"]';

/** Text that is never shown: its currencies are a script's, not the page's. */
const HIDDEN_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);

/**
 * Bounded on both counts. A page is read once, in idle time, and a catalogue
 * of a thousand products says what its first screens already said.
 */
const MAX_TEXT = 50_000;
const MAX_DECLARED = 20;

/**
 * Visible text by walking text nodes, rather than `innerText`, which lays the
 * whole page out, or `textContent`, which includes every inline script and so
 * every currency a shop's JavaScript knows how to print.
 */
function pageText(root: Element): string {
  // Elements are visited only to be rejected: a rejected element takes its
  // whole subtree with it, which a text-only walk cannot do.
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      return HIDDEN_TAGS.has((node as Element).tagName.toUpperCase())
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_SKIP;
    },
  });
  const parts: string[] = [];
  let length = 0;
  let node: Node | null;
  while (length < MAX_TEXT && (node = walker.nextNode())) {
    const data = (node as Text).data;
    parts.push(data);
    length += data.length + 1;
  }
  // Joined with a line break so two nodes never glue into one word or one price.
  return parts.join('\n').slice(0, MAX_TEXT);
}

export function collectPageSignals(doc: Document): PageSignals {
  const declared: string[] = [];
  for (const node of doc.querySelectorAll(DECLARED_SELECTOR)) {
    if (declared.length >= MAX_DECLARED) break;
    const value = (node.getAttribute('content') ?? node.textContent ?? '').trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(value)) declared.push(value);
  }
  const text = doc.body ? pageText(doc.body) : '';
  return { text, declared, priced: writtenCurrencyCounts(text) };
}
