<div align="center">

# PriceHover

Hover over any price on any webpage and instantly see it converted to your currencies.

![PriceHover](banner.png)

</div>

## Install

[Chrome Web Store](#) · [Firefox Add-ons](https://addons.mozilla.org/fr/firefox/addon/pricehover)

## How it works

- Hover a price → tooltip with conversions appears
- Select text containing a price → same
- Click the extension icon to pick your currencies or use it as a quick converter

Exchange rates update every 24 hours via [open.er-api.com](https://open.er-api.com). That is the only host the extension contacts: flags are bundled, prices are detected locally, and nothing about the pages you visit ever leaves your browser.

## Build

```bash
bun install
bun run build          # Chrome MV3
bun run build:firefox  # Firefox MV3
bun test               # detector and rates unit tests
bun run typecheck
```

Regenerating assets (rarely needed, both commit their output):

```bash
bun run icons          # public/icons/*.png
bun run flags          # src/flags.ts, after adding or removing a currency
```

## Privacy

[Privacy Policy](https://klnuno.github.io/PriceHover/PRIVACY)
