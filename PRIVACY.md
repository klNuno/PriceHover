---
layout: default
title: Privacy Policy
---
# Privacy Policy — PriceHover

**Last updated: 2026-07-26**

## Data collected

PriceHover collects no personal data. Nothing about you, your browsing or the pages you visit is sent anywhere.

- **Exchange rates** are fetched at most once a day from [open.er-api.com](https://open.er-api.com). The request carries no user data and nothing about the page you are on.
- **Your settings** — currencies, rounding, hover delay and the list of sites you paused — are stored locally using the browser's built-in extension storage (`chrome.storage.local`). This data never leaves your device.
- **Page content** is read locally to detect prices. Nothing is sent to any server.
- **The page's domain and language** are read locally to tell a Canadian `$` from an American one. They are used in the page they came from and stored nowhere.
- **Country flags** are bundled inside the extension. No image, font or script is loaded from a third party while you browse.
- **No browsing history is kept.** The list of paused sites contains only the domains you added yourself.

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Save your settings locally |
| `activeTab` | Show the current site's name in the popup, so you can pause PriceHover on it. Granted only for the tab you are looking at, and only at the moment you click the extension icon. |
| `host_permissions: open.er-api.com` | Fetch daily exchange rates |

## Third-party services

- **open.er-api.com** — exchange rate data, contacted at most once a day (see their [privacy policy](https://www.exchangerate-api.com/privacy))

It is the only host the extension ever contacts.

## Contact

For any questions, open an issue at [github.com/klNuno/PriceHover](https://github.com/klNuno/PriceHover).
