---
layout: default
title: Privacy Policy
---
# Privacy Policy — PriceHover

**Last updated: 2026-03-03**

## Data collected

PriceHover collects no personal data and makes no external requests on your behalf.

- **Exchange rates** are fetched once per day from [open.er-api.com](https://open.er-api.com) by the extension's background script. This request contains no user data.
- **Your currency preferences** are stored locally in your browser using the browser's built-in extension storage (`chrome.storage.local`). This data never leaves your device.
- **Page content** is read locally to detect prices. Nothing is sent to any server.

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Save your selected currencies locally |
| `alarms` | Refresh exchange rates every 24 hours |
| `host_permissions: open.er-api.com` | Fetch daily exchange rates |
| `host_permissions: flagcdn.com` | Load country flag images in the tooltip |

## Third-party services

- **open.er-api.com** — exchange rate data (see their [privacy policy](https://www.exchangerate-api.com/privacy))
- **flagcdn.com** — flag images (no tracking)

## Contact

For any questions, open an issue at [github.com/klNuno/PriceHover](https://github.com/klNuno/PriceHover).
