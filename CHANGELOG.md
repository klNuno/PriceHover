# Changelog

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
- Semantic detection (`itemprop="price"`, `data-price`) shows a tooltip again. It reported a price with no text offsets, and the hitbox rewrite silently dropped every one of them. It also now rejects currencies the extension cannot convert instead of matching a price to nothing.

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
- The release workflow no longer submits to the Chrome Web Store or AMO — both are published by hand. It pins every action to a commit SHA, installs with a frozen lockfile, and refuses to release when the tag and `package.json` disagree.
- Dropped `tailwindcss` and `@tailwindcss/vite`, unused anywhere in the codebase.
