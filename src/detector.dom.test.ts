import { GlobalRegistrator } from '@happy-dom/global-registrator';
// Bun shares one process across test files, and registering twice throws.
if (!globalThis.document) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { detectPricesFromElement } from './detector';

function mount(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
}

/** The element the cursor would actually land on, not its container. */
function target(html: string, selector: string): Element {
  mount(html);
  return document.querySelector(selector)!;
}

describe('semantic detection', () => {
  test('reads schema.org markup where priceCurrency is a sibling', () => {
    // This is how real Offer markup is written, and walking ancestors alone
    // never finds both halves of it.
    const el = target(
      `<div itemscope itemtype="https://schema.org/Offer">
         <meta itemprop="priceCurrency" content="JPY">
         <span itemprop="price" content="24800">Twenty-four thousand</span>
       </div>`,
      '[itemprop="price"]'
    );
    expect(detectPricesFromElement(el)).toEqual([{ amount: 24800, currencyCode: 'JPY' }]);
  });

  test('reads price and currency on the same element', () => {
    const el = target(`<div data-price="49.90" data-currency="brl">Preço</div>`, 'div');
    expect(detectPricesFromElement(el)).toEqual([{ amount: 49.9, currencyCode: 'BRL' }]);
  });

  test('reads them from an ancestor', () => {
    const el = target(
      `<div data-price="1200" data-currency="SEK"><span><b>Pris</b></span></div>`,
      'b'
    );
    expect(detectPricesFromElement(el)).toEqual([{ amount: 1200, currencyCode: 'SEK' }]);
  });

  test('ignores a currency the extension cannot convert', () => {
    const el = target(`<div data-price="500" data-currency="LOYALTYPOINTS">500 points</div>`, 'div');
    expect(detectPricesFromElement(el)).toEqual([]);
  });

  test('a page-wide itemscope does not price every element on the page', () => {
    // SteamDB marks up <body itemscope> with one <meta itemprop="price"> for
    // the app. Reading that meta for any element under it turned every word on
    // the page into the same price: hovering the site header's "Sales" link
    // reported the game's cost.
    document.body.innerHTML = `
      <meta itemprop="priceCurrency" content="USD">
      <meta itemprop="price" content="39.99">
      <nav><a id="link">Sales</a></nav>
      <table><tr><td id="cell">Rp 479000</td></tr></table>`;
    document.body.setAttribute('itemscope', '');
    try {
      expect(detectPricesFromElement(document.querySelector('#link')!)).toEqual([]);
      const cell = detectPricesFromElement(document.querySelector('#cell')!);
      expect(cell.map((p) => [p.amount, p.currencyCode])).toEqual([[479000, 'IDR']]);
    } finally {
      document.body.removeAttribute('itemscope');
    }
  });

  test('an offer container still prices the element that holds it', () => {
    // The rule is descent, not distance: hovering the container of a real Offer
    // has to keep working, and the price sits inside it.
    const el = target(
      `<div id="offer" itemscope itemtype="https://schema.org/Offer">
         <meta itemprop="priceCurrency" content="JPY">
         <span itemprop="price" content="24800">Twenty-four thousand</span>
       </div>`,
      '#offer'
    );
    expect(detectPricesFromElement(el)).toEqual([{ amount: 24800, currencyCode: 'JPY' }]);
  });

  test('falls through to the regex when the markup is incomplete', () => {
    // A price with no currency annotation must not shadow the text detector.
    const el = target(`<div itemscope><span itemprop="price" content="30">¥1980</span></div>`, 'span');
    const found = detectPricesFromElement(el);
    expect(found.map((p) => [p.amount, p.currencyCode])).toEqual([[1980, 'JPY']]);
  });
});

describe('text detection in the DOM', () => {
  test('finds a price split across sibling elements', () => {
    const el = target(`<span id="p"><span>¥</span><span>348</span></span>`, '#p');
    const found = detectPricesFromElement(el);
    expect(found.map((p) => [p.amount, p.currencyCode])).toEqual([[348, 'JPY']]);
  });

  test('finds every price in a short container', () => {
    const el = target(`<div id="p"><span>-20%</span> <s>¥ 3980</s> <b>¥ 3184</b></div>`, '#p');
    expect(detectPricesFromElement(el).map((p) => p.amount)).toEqual([3980, 3184]);
  });

  test('reports offsets against the text it actually analyzed', () => {
    const el = target(`<div id="p">Now ¥1980 only</div>`, '#p');
    const [price] = detectPricesFromElement(el);
    const text = el.textContent!;
    expect(price.textSource).toBe('full');
    expect(text.slice(price.matchStart, price.matchEnd)).toBe('¥1980');
  });

  test('a long container falls back to its own text nodes', () => {
    const filler = 'word '.repeat(40);
    const el = target(`<div id="p"><span>${filler}</span> ¥12,800</div>`, '#p');
    const [price] = detectPricesFromElement(el);
    expect(price.textSource).toBe('direct');
    const direct = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join('');
    expect(direct.slice(price.matchStart, price.matchEnd)).toBe('¥12,800');
  });

  test('prose in a container yields nothing', () => {
    const el = target(`<p id="p">This module requires PHP 8.2 and you can try 100 times.</p>`, '#p');
    expect(detectPricesFromElement(el)).toEqual([]);
  });
});
