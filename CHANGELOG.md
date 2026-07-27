# Changelog

## 2.0.0

The major bump is for the reading change, not the feature list: a `$` price on
a country domain now converts as that country's dollar. Anyone who preferred
the old behaviour can restore it under Behaviour → *Read `$`, `kr` and `¥` from
the site's country*. Settings from 1.x are migrated on first run; the old flat
currency list becomes your base currency plus targets, in the order it was in.

### Correctness

- `$` no longer always means US dollars. On a country domain, or a page whose `lang` names a region, `$`, `kr` and `¥` are read as the local currency. `$49` on a `.ca` site is Canadian, `1 099 kr` on a `.no` site is Norwegian, `¥` on a `.cn` site is yuan. The tooltip says when it made that call. This was the one thing the extension got confidently, silently wrong. Switch it off under Behaviour if you prefer the old reading.
- Vanity ccTLDs (`.co`, `.io`, `.ai`, `.me`, `.tv`, `.to`) are deliberately not treated as country signals.
- Price ranges are understood: `€10 – €20`, `€10-20` and `10-20 kr` convert as one range instead of one price, or none. `€10-20% off` is still a single price.
- Every currency now rounds to its own minor unit. `KWD 12.500` was truncated to two decimals because the formatter hardcoded a cap for everything but JPY and KRW.
- Added ISK, so `kr` can resolve to all four krona currencies.
- Three-decimal currencies read a comma as thousands again. Kuwait writes `1,250.500` exactly as the US writes `1,250.50`, so the rule that keeps `KD 12.500` at twelve and a half was applying to the wrong separator: `KD 1,250` showed as 1.25 dinars, and `KWD 1,250.500` as 1 250 500.
- A trailing group of three after a lone zero is decimals, not thousands. `$0.001` converted as one dollar.
- `CA $30` is Canadian. A qualifier one space from its sign fell through to the bare `$` and read as thirty US dollars. `C$` and `AU$` are understood too.
- `USD 12.5` and `12.5 USD` convert. A single fraction digit was rejected behind every alphabetic token, which was aimed at `PHP 8.2` and caught every ISO code with it. The popup calculator refused `12.5 usd` for the same reason.
- Prose stopped being read as prices in four more shapes: `Requires PHP 8`, an all-caps `TRY 100 TIMES`, `CRC32`, `COP21`, `R2-D2`, and a twenty-digit order number after a `$`.
- A discount line is not a price. `-$5.00` converted to a positive five dollars, which says the opposite of what the page says.
- A figure space (U+2007) groups an amount like any other space. `1 234,56 €` read as 234.56.
- `€10-20 % off` is a price and a discount, like `€10-20% off` already was. A merged range no longer leaves its upper bound behind as a second price with an overlapping hitbox.
- An amount too small for its currency's minor unit prints its real value instead of zero. One VND is four hundredths of a US cent, and every rounding mode said `$0.00`.

### Interface

- A hover delay, 180 ms by default. Sweeping the pointer across a page of prices no longer flashes a tooltip on every one of them, and does no detection work either.
- Scrolling moves the tooltip with the price instead of dismissing it. A nudge of the wheel used to hide it until you left the element and came back.
- The tooltip can be clicked: a click on any row copies the amount. Reaching it works at any pointer speed. The gap between the price and the card was checked against the pointer's previous position, so a hand that crossed it in one movement lost the tooltip on the way.
- Your own currency is an explicit setting now, shown first in the tooltip and never converted away from. The popup lists your chosen currencies before the other forty.
- The tooltip flips below a price only when it actually fits below. It used to flip whenever it did not fit above, and clip off the bottom of the screen.
- Keyboard focus is visible in the popup. The checkbox is a clipped pixel for screen readers, and nothing drew a ring for it, so tabbing through the list showed nothing at all.
- Optional rounding. A conversion is an estimate; `≈€1,235` says so where `€1,234.56` pretends otherwise.
- Rate freshness is visible in the popup and the options page, with a refresh button, and the tooltip warns when rates are more than two days old.
- A first install opens the options page instead of leaving an unexplained icon in the toolbar.

### Features

- A master switch and a per-site pause, both reachable from the popup. A misfire on one site no longer means uninstalling.
- Inline mode: PriceHover can write your currency beside every price on the page instead of waiting for a hover. It only ever appends (the site's own text is never rewritten) and it skips editable fields, `code`, `pre` and anything machine-read.
- A full options page: currencies with drag-free reordering, behaviour, paused sites, rates and privacy.
- Translated into English, French, Spanish, German, Brazilian Portuguese, Italian, Japanese and Simplified Chinese. Amounts are formatted in the browser's language too.

### Performance

- Text with no digit in it is skipped before the regex runs. That is most of the text on most pages, and it takes a hover over a paragraph from 160 µs to 0.1 µs.
- The tooltip and its shadow root are built on the first price found, not on every page load. Pages with no price now mount nothing.
- Semantic markup is checked with one selector match instead of walking six ancestors and reading four attributes from each.
- Exchange rates are read from storage on first need rather than on every page load.
- The tooltip measures itself once per layout, not on every reposition.

### Privacy

- The rate request is made by the background, never by the content script. A fetch issued from a page carries that page's origin, so `open.er-api.com` was told the address of every site where a price was hovered, which is exactly what bundling the flags was meant to prevent. It also ran under the visited page's own content security policy, so a site with a strict `connect-src` blocked it and left the tooltip empty on a cold start.
- The tooltip's clipboard fallback no longer puts a scratch element in the page. It lived in `document.body`, where a site could read the converted amount, or intercept the copy event and substitute its own text while PriceHover still said "Copied".
- Inline mode never splits the page's own text nodes. It appended without rewriting, but the split alone was enough to make a framework holding that node duplicate the text around the badge.

### Permissions

- Added `activeTab`, which is what lets the popup name the site you are on so you can pause it. It grants access to one tab, only when you click the extension icon, and shows no install warning. The extension still contacts exactly one host.

### License

- Relicensed from MIT to **GPL-3.0-or-later**. A fork that gets distributed, published to a store included, now has to release its source under the same terms. Every dependency is GPL-compatible, and only Svelte (MIT) ships inside the extension.

## 1.3.0

### Privacy

- Country flags are now bundled inside the extension instead of being loaded from `flagcdn.com`. The tooltip used to request an image from a third party on every page where a price was hovered, which handed that host the origin of the visited page. The extension now contacts a single host, `open.er-api.com`, for exchange rates and nothing else.
- `PRIVACY.md` matched neither the manifest nor the code: it listed an `alarms` permission removed in 1.2.4, listed a `flagcdn.com` host permission that never existed, and claimed no external request was made. Rewritten to match what ships.

### Detection

- Currency matching is case-sensitive. `try 100 times`, `requires php 8.2` and similar prose no longer register as TRY and PHP amounts.
- Ambiguous short tokens got positional rules. `RM`, `SR`, `QR`, `KD` and `Rp` only count in front of the amount, so `Version 5 RM` and `error code 500 KD` are ignored. A bare `R` only means rand when glued to the digits (`R199`), so `see section R 5` is ignored.
- Amounts are no longer silently truncated. `€1234.5678` used to display as €1234.56; it now matches nothing.
- Fixed a thousands-separator bug: `1.234,567` returned 1.234567 instead of 1234567.
- `KWD` and other three-decimal currencies keep their decimals instead of being read as thousands.
- Added `Kč`, `Ft`, `US$`, `S/`, `Fr.`, `kr.`, `د.إ` and `﷼`, which were listed as currency symbols or printed in the wild but absent from the matcher.
- Indian lakh grouping is understood: `₹1,49,900` reads as 149900 instead of matching nothing.
- Semantic detection (`itemprop="price"`, `data-price`) works again, on two counts. It reported a price with no text offsets and the hitbox rewrite silently dropped every one of them; and it only ever walked ancestors, while real schema.org markup puts `priceCurrency` in a `<meta>` *beside* the price, so it almost never found both halves. It now searches inside the enclosing `itemscope` and rejects currencies the extension cannot convert.

### Correctness

- The hover cache is invalidated when an element's text changes, so a price updated in place (SPA, on-site currency switcher) no longer shows a stale conversion.
- Exchange rate payloads are validated. A malformed response is rejected instead of producing `NaN` conversions.
- The tooltip appears on its own once rates finish loading, instead of staying silent on the first hover of a cold start.
- Teardown moved from the deprecated `unload` event to `pagehide`, which also fires for back/forward cache navigations.
- The popup reads its version from the manifest. It was hardcoded and already one release behind.

### Project

- Unit tests for the detector and the rate parser, run in CI along with a typecheck. There were none.
- `tsc --noEmit` passes. It never did: `@types/chrome` was missing and `wxt.config.ts` still set `extensionApi`, removed in WXT 0.20.
- The version lives in `package.json` only. It used to be spread across `package.json`, `wxt.config.ts` and the popup markup, with all three disagreeing.
- The release workflow no longer submits to the Chrome Web Store or AMO, since both are published by hand. It pins every action to a commit SHA, installs with a frozen lockfile, and refuses to release when the tag and `package.json` disagree.
- Dropped `tailwindcss` and `@tailwindcss/vite`, unused anywhere in the codebase.
