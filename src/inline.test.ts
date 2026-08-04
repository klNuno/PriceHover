import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!globalThis.document) GlobalRegistrator.register();

/**
 * happy-dom (20.11.1) holds a MutationObserver's callback behind a `WeakRef`
 * and keeps no strong reference to it, so a garbage collection stops delivering
 * records to a live observer. That is what made three of these tests fail about
 * one run in six, and always the ones that mutate the page after the first
 * pass: the annotator's observer had been collected out from under them.
 *
 * Keeping every referent alive removes the collection, and with it the flake.
 * It is scoped to this file and says nothing about the extension, which runs
 * against a browser's own implementation.
 */
const keptAlive = new Set<object>();
const NativeWeakRef = globalThis.WeakRef;
globalThis.WeakRef = class<T extends object> extends NativeWeakRef<T> {
  constructor(target: T) {
    super(target);
    keptAlive.add(target);
  }
} as typeof WeakRef;

import { afterEach, describe, expect, test } from 'bun:test';
import { setCryptoDetection } from './detector';
import { createInlineAnnotator, INLINE_ATTR } from './inline';
import { DEFAULT_SETTINGS } from './settings';
import type { Settings } from './settings';
import type { ExchangeRates } from './types';

const RATES: ExchangeRates = { USD: 1, EUR: 0.9, JPY: 150, GBP: 0.8 };

let annotator: ReturnType<typeof createInlineAnnotator> | null = null;

afterEach(() => {
  annotator?.destroy();
  annotator = null;
  document.body.innerHTML = '';
});

function mount(
  html: string,
  overrides: Partial<Settings> = {},
  onUnpriced?: (code: string) => void
) {
  document.body.innerHTML = html;
  const settings: Settings = { ...DEFAULT_SETTINGS, baseCurrency: 'EUR', rounding: 'exact', ...overrides };
  annotator = createInlineAnnotator({
    settings: () => settings,
    rates: () => RATES,
    resolver: () => undefined,
    onUnpriced,
  });
  return annotator;
}

const badges = (): string[] =>
  [...document.querySelectorAll(`[${INLINE_ATTR}]`)].map((el) => el.textContent ?? '');

/**
 * The annotator works in idle slices, and how many of them a pass takes is a
 * property of the machine, not of the code under test. Given the badges a pass
 * should end on, this returns as soon as they are there and gives a loaded
 * runner up to three seconds to get there.
 *
 * Without them it waits for the badges to stop changing instead, which is the
 * only thing available when the expectation is that nothing happens.
 */
const flush = async (expected?: string[]): Promise<void> => {
  const target = expected?.join('|');
  let previous = '';
  let stable = 0;
  for (let i = 0; i < 150; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const current = badges().join('|');
    if (target !== undefined) {
      if (current === target) return;
      continue;
    }
    stable = current === previous ? stable + 1 : 0;
    previous = current;
    if (stable >= 4) return;
  }
};

describe('inline annotation', () => {
  test('appends the base currency beside a price', async () => {
    mount('<p>Only $10.00</p>').scan(document.body);
    await flush(['(€9.00)']);
    expect(badges()).toEqual(['(€9.00)']);
  });

  test('reports a price it holds no rate for', async () => {
    // Inline never hovers anything, so this callback is the only way the
    // content script hears that a page is priced in an asset whose rate was
    // never fetched. Without it a page of BTC prices stayed bare for good.
    const seen: string[] = [];
    setCryptoDetection(true);
    try {
      mount('<p>Only 0.05 BTC</p>', { cryptoEnabled: true }, (code) => seen.push(code))
        .scan(document.body);
      await flush();
    } finally {
      setCryptoDetection(false);
    }
    expect(badges()).toEqual([]);
    expect(seen).toEqual(['BTC']);
  });

  test('leaves the site’s own text untouched', async () => {
    mount('<p id="p">Only $10.00</p>').scan(document.body);
    await flush(['(€9.00)']);
    // Rewriting a price in place would destroy information the user may need;
    // the badge only ever sits next to it.
    const text = document.querySelector('#p')!.firstChild as Text;
    expect(text.data).toBe('Only $10.00');
  });

  test('leaves a price in the middle of a text node alone', async () => {
    // Annotating it would mean splitText, and a framework holding that Text
    // node then writes into the head while the orphaned tail stays on screen.
    mount('<p id="p">Only $10.00 today</p>').scan(document.body);
    await flush();
    const text = document.querySelector('#p')!.firstChild as Text;
    expect(text.data).toBe('Only $10.00 today');
    expect(text.nextSibling).toBeNull();
    expect(badges()).toEqual([]);
  });

  test('annotates a price followed only by whitespace', async () => {
    // Markup indentation puts a newline after nearly every price; the badge
    // still goes after the whole node, so nothing is split.
    mount('<p id="p">\n  $10.00\n</p>').scan(document.body);
    await flush(['(€9.00)']);
    expect(badges()).toEqual(['(€9.00)']);
    expect((document.querySelector('#p')!.firstChild as Text).data).toBe('\n  $10.00\n');
  });

  test('ignores text inside SVG', async () => {
    // tagName is lowercase outside the HTML namespace, and an HTML span dropped
    // into an <svg> renders nothing while still spending the budget.
    mount('<svg><text>$10.00</text></svg>').scan(document.body);
    await flush();
    expect(badges()).toEqual([]);
  });

  test('ignores prices already in the base currency', async () => {
    mount('<p>Only €10.00 today</p>').scan(document.body);
    await flush();
    expect(badges()).toEqual([]);
  });

  test('annotates every eligible node, in document order', async () => {
    mount('<p><span>Was $20.00</span><span>, now $10.00</span></p>').scan(document.body);
    await flush(['(€18.00)', '(€9.00)']);
    expect(badges()).toEqual(['(€18.00)', '(€9.00)']);
  });

  test('skips editable and machine-read containers', async () => {
    mount(`
      <textarea>$10.00</textarea>
      <code>$10.00</code>
      <div contenteditable="true">$10.00</div>
      <p>$10.00</p>
    `).scan(document.body);
    await flush(['(€9.00)']);
    expect(badges()).toEqual(['(€9.00)']);
  });

  test('never annotates its own output', async () => {
    // The badge contains a price. Without the marker check the observer would
    // annotate it, then annotate that, forever.
    mount('<p>$10.00</p>').scan(document.body);
    await flush();
    expect(badges()).toHaveLength(1);
  });

  test('picks up nodes added after the first pass', async () => {
    const instance = mount('<div id="host"></div>');
    instance.scan(document.body);
    await flush();

    document.querySelector('#host')!.innerHTML = '<span>$10.00</span>';
    await flush(['(€9.00)']);
    expect(badges()).toEqual(['(€9.00)']);
  });

  test('a price rewritten in place replaces its badge instead of gaining one', async () => {
    // An SPA switching variants edits the text node under our badge. Without
    // replacing it the page ends up showing the old conversion beside the new
    // price, and then a second one beside that.
    const instance = mount('<p id="p">$10.00</p>');
    instance.scan(document.body);
    await flush(['(€9.00)']);
    expect(badges()).toEqual(['(€9.00)']);

    document.querySelector('#p')!.textContent = '$20.00';
    await flush(['(€18.00)']);
    expect(badges()).toEqual(['(€18.00)']);
  });

  test('refresh removes what it added before adding again', async () => {
    const instance = mount('<p>$10.00</p>');
    instance.scan(document.body);
    await flush();

    instance.refresh();
    await flush();
    expect(badges()).toEqual(['(€9.00)']);
  });

  test('destroy leaves the page as it was found', async () => {
    const instance = mount('<p id="p">Only $10.00</p>');
    instance.scan(document.body);
    await flush(['(€9.00)']);
    expect(badges()).toHaveLength(1);

    instance.destroy();
    annotator = null;
    expect(document.querySelectorAll(`[${INLINE_ATTR}]`)).toHaveLength(0);
    expect(document.querySelector('#p')!.textContent).toBe('Only $10.00');
  });

  test('badges the page threw away stop counting against the budget', async () => {
    // Removing a subtree never calls back into the annotator, so a page that
    // swaps its content used to exhaust the 600 badge budget with nothing left
    // on screen and then annotate nothing ever again.
    const bulk = Array.from({ length: 610 }, () => '<p>$10.00</p>').join('');
    const instance = mount(`<div id="bulk">${bulk}</div>`);
    instance.scan(document.body);
    await flush();
    expect(badges().length).toBeGreaterThanOrEqual(600);

    document.querySelector('#bulk')!.remove();
    expect(badges()).toEqual([]);

    document.body.insertAdjacentHTML('beforeend', '<p id="late">$10.00</p>');
    await flush(['(€9.00)']);
    expect(badges()).toEqual(['(€9.00)']);
  });

  test('honours the rounding setting', async () => {
    mount('<p>$10.50</p>', { rounding: 'integer' }).scan(document.body);
    await flush(['(≈€9)']);
    expect(badges()).toEqual(['(≈€9)']);
  });
});
