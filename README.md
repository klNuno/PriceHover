<h1 align="center">PriceHover</h1>
<p align="center">Hover any price on any page and read it in your own currency. Chrome and Firefox, MV3, built with WXT and Svelte 5.</p>

<p align="center">
  <img src="./screenshots/demo-hover.webp" alt="Hovering a yen price on a shop page, clicking a tooltip row to copy the amount, then hovering a price range" />
</p>

<p align="center">
  <a href="https://github.com/klNuno/PriceHover/releases"><img src="https://img.shields.io/github/v/release/klNuno/PriceHover?display_name=tag" alt="Release" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/klNuno/PriceHover" alt="License" /></a>
  <a href="https://github.com/klNuno/PriceHover/stargazers"><img src="https://img.shields.io/github/stars/klNuno/PriceHover" alt="Stars" /></a>
  <a href="#install"><img src="https://img.shields.io/badge/browser-Chrome%20%7C%20Firefox-0078D6" alt="Browser" /></a>
  <a href="https://wxt.dev/"><img src="https://img.shields.io/badge/WXT-0.20-67D75B" alt="WXT" /></a>
  <a href="https://svelte.dev/"><img src="https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte" alt="Svelte" /></a>
</p>

## Why

A price in a currency you do not think in costs a tab, a search box and your
place in the page. PriceHover reads it where it sits. No account, no paste, one
request a day for the rates.

## Features

- **Hover or select** a price. Your own currency comes first and is never converted away from.
- **`$` means what the site means.** `$49` on a `.ca` shop is Canadian, `1 099 kr` on a `.no` shop is Norwegian, `¥` on a `.cn` shop is yuan.
- **Prose stays prose.** `try 100 times` and `error code 500 KD` are not prices. Every ambiguous token has a rejection test behind it.
- **Ranges.** `€10 – €20`, `€10-20` and `10-20 kr` convert as one range.
- **Click a row to copy** the amount.
- **Inline mode.** Write your currency beside every price instead of waiting for a hover. It only ever appends.
- **Two switches.** A master one and a per-site pause, both in the popup.
- **Rounding.** `≈€1,235` where `€1,234.56` would pretend to a precision a conversion does not have.
- **44 currencies, eight languages.** Flags are bundled, nothing is fetched from a third party.

> [!NOTE]
> 2.0.0 changed how `$` is read. On a country domain it now converts as that
> country's dollar, not as USD. Settings → **Behaviour** → *Read `$`, `kr` and
> `¥` from the site's country* puts the old reading back.

## The same `$49.99`, two shops

<p align="center">
  <img src="./screenshots/context.png" alt="The same $49.99 on a .com shop and on a .ca shop, converting to €44 and €31" />
</p>

The country comes from the domain, or from the region in `<html lang>` when the
domain says nothing. Vanity endings (`.co`, `.io`, `.ai`, `.me`, `.tv`, `.to`)
are ignored, because the country in them means nothing.

| On the page | Read as |
| --- | --- |
| `¥74,800` on a `.jp` shop | 74 800 JPY |
| `¥74,800` on a `.cn` shop | 74 800 CNY |
| `₹1,49,900` | 149 900 INR (Indian lakh grouping) |
| `KD 12.500` | 12.500 KWD (three decimals, not thousands) |
| `€10-20` | a range, 10 to 20 EUR |
| `try 100 times`, `requires PHP 8.2`, `error code 500 KD` | nothing |

## Inline mode

<p align="center">
  <img src="./screenshots/inline.png" alt="A price block with the euro equivalent appended in brackets after each yen amount" />
</p>

Off by default. The site's own text is never rewritten, only appended to, and
text fields, editable areas, `code` and `pre` are left alone.

## The popup is also a converter

<p align="center">
  <img src="./screenshots/popup.png" alt="The PriceHover popup converting 250 CHF into a list of currencies" width="300" />
</p>

Type `250 chf`, `20 usd jpy`, or a bare number to convert from your own
currency. The footer says how old the rates are and refreshes them on demand.

## Settings

<p align="center">
  <img src="./screenshots/options.png" alt="The PriceHover settings page: currencies, behaviour, paused sites, about" />
</p>

Your own currency, the list to convert into and its order, hover delay,
rounding, inline mode and paused sites.

## Privacy

PriceHover contacts exactly one host, `open.er-api.com`, and asks it one
question: today's exchange rates. That request carries nothing about you or the
page you are on. Prices are detected on your machine, flags are bundled in the
extension, and there is no analytics, no telemetry and no identifier. Three
permissions: `storage`, `activeTab` and access to `open.er-api.com`.

Full details in the [privacy policy](PRIVACY.md).

## Install

- **Firefox**: [addons.mozilla.org](https://addons.mozilla.org/firefox/addon/pricehover).
- **Chrome**: the zip on [Releases](https://github.com/klNuno/PriceHover/releases)
  loads unpacked from `chrome://extensions` with developer mode on. The Web
  Store listing is published by hand, so it can trail a tag by a few days.

## Build from source

```bash
bun install
bun run dev            # Chrome, hot reload
bun run build          # Chrome MV3  -> .output/chrome-mv3
bun run build:firefox  # Firefox MV3 -> .output/firefox-mv3
bun test               # unit tests, plus DOM tests under happy-dom
bun run typecheck      # tsc --noEmit, kept clean and enforced in CI
```

`bun run icons`, `bun run flags` and `bun run locales` regenerate committed
files and never run at build time. A release is cut by pushing a `vX.Y.Z` tag:
CI refuses a tag that disagrees with `package.json`, builds both targets and
attaches the zips.

## Contributing

Issues and pull requests are welcome. Keep `bun test` and `bun run typecheck`
clean, and never add a runtime request to a second host. Detection is the part
that breaks quietly: a token accepted one position too freely turns `error code
500 KD` into a price, so every new one arrives with the case that must stay
silent.

## License

[GNU General Public License v3.0 or later](LICENSE). Use it, read it, fork it.
Distributing a modified version, publishing a fork to a browser store included,
means releasing its source under the same license. Every dependency is
GPL-compatible, and only Svelte (MIT) ships inside the extension.
