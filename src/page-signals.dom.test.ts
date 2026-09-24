import { GlobalRegistrator } from '@happy-dom/global-registrator';
// Bun shares one process across test files, and registering twice throws.
if (!globalThis.document) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { detectPricesFromElement } from './detector';
import { makeTokenResolver, pageChoice } from './locale';
import { collectPageSignals, rowContext } from './page-signals';

describe('rowContext', () => {
  // SteamDB's regional price table, trimmed: one currency per row, and a yen
  // row on the same page as the yuan one.
  const table = `
    <table><tbody>
      <tr><td>Chinese Yuan Renminbi</td><td id="cny">¥ 69</td><td>$9.66</td></tr>
      <tr><td>Japanese Yen</td><td id="jpy">¥ 1,980</td><td>$13.40</td></tr>
      <tr><td>Canadian Dollar</td><td id="cad">CDN$ 54.99</td><td id="usd">$40.04</td></tr>
    </tbody></table>`;

  test('the row names the yuan, so its ¥ is yuan', () => {
    document.body.innerHTML = table;
    const cell = document.getElementById('cny')!;
    const context = rowContext(cell)!;
    expect(context.choice).toEqual({ '¥': 'CNY' });
    const resolve = makeTokenResolver('steamdb.info', 'en', { context: context.choice })!;
    expect(detectPricesFromElement(cell, resolve)[0].currencyCode).toBe('CNY');
  });

  test('the yen row stays yen', () => {
    document.body.innerHTML = table;
    const context = rowContext(document.getElementById('jpy')!);
    expect(context?.choice ?? {}).toEqual({ '¥': 'JPY' });
  });

  test('a row that prints its own dollar leaves the bare one alone', () => {
    document.body.innerHTML = table;
    expect(rowContext(document.getElementById('usd')!)).toBeNull();
  });

  test('no row, no context', () => {
    document.body.innerHTML = '<p>Chinese yuan <span id="p">¥ 69</span></p>';
    expect(rowContext(document.getElementById('p')!)).toBeNull();
  });

  test('a row holding half the page says nothing', () => {
    document.body.innerHTML = `<ul><li>CNY ${'filler '.repeat(120)}<span id="p">¥ 69</span></li></ul>`;
    expect(rowContext(document.getElementById('p')!)).toBeNull();
  });
});

describe('collectPageSignals', () => {
  test('reads declarations, written prices and visible codes', () => {
    document.head.innerHTML = '<meta property="og:price:currency" content="cad">';
    document.body.innerHTML = `
      <header><select><option>CAD</option></select></header>
      <p>$49.99 CAD</p><p>$12</p>
      <script>var all = ["USD","USD","USD","AUD"]</script>`;
    const signals = collectPageSignals(document);
    expect(signals.declared).toEqual(['CAD']);
    expect(signals.priced.get('CAD')).toBe(1);
    expect(signals.text).not.toContain('AUD');
    expect(pageChoice(signals)).toEqual({ '$': 'CAD' });
  });

  test('a page that says nothing decides nothing', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<p>Only $12 and $15 here.</p>';
    expect(pageChoice(collectPageSignals(document))).toEqual({});
  });

  test('two text nodes never glue into one code', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<span>CA</span><span>D</span>';
    expect(collectPageSignals(document).text).not.toContain('CAD');
  });
});
