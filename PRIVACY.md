---
layout: default
title: Privacy Policy
---
# Privacy Policy — PriceHover

**Last updated: 2026-07-26 — applies to version 2.0.0**

## The short version

PriceHover contacts exactly one host, `open.er-api.com`, and asks it one
question: what are today's exchange rates. That request says nothing about you
or about the page you are on. Everything else — detecting prices, converting
them, drawing the tooltip — happens on your machine.

There is no analytics, no telemetry, no error reporting, no account, and no
identifier of any kind.

## What is collected

Nothing is collected. For completeness, here is every piece of data the
extension touches and where it goes.

| Data | Where it goes |
|---|---|
| The text of pages you visit | Read in the page, never sent anywhere. Used to find prices. |
| The page's domain and `<html lang>` | Read in the page, never sent anywhere, never stored. Used to tell a Canadian `$` from an American one. |
| Your settings — currencies, rounding, hover delay, paused sites | `chrome.storage.local` on your own machine. Never sent anywhere. |
| Exchange rates | Fetched from `open.er-api.com`, cached on your machine. |
| The address of the tab you are on | Read only in the popup, only while it is open, only to show you which site the pause switch applies to. Never stored, never sent. |

**No browsing history is kept.** The paused-sites list contains only the domains
you chose to pause, and nothing else is ever written to storage.

## Permissions, and why each one exists

| Permission | Why |
|---|---|
| Access to page content on all sites (`content_scripts: <all_urls>`) | A price can be on any page, so the detector has to run on any page. It reads text and, in inline mode, appends a label next to a price. It never sends page data anywhere. Your browser may describe this as "read and change all your data on all websites" — that is the standard wording for any content script. |
| `storage` | Keep your settings between sessions. |
| `activeTab` | Show the current site's name in the popup so the pause switch can name it. Granted for one tab, only at the moment you click the extension icon, and never at rest. |
| `open.er-api.com` host access | Fetch exchange rates. The only network destination in the extension. |

The extension deliberately does **not** ask for `tabs`, `alarms`,
`clipboardWrite`, `webRequest`, `history`, or `cookies`.

## Network requests

One, to `https://open.er-api.com/v6/latest/USD`:

- at most once every 24 hours, and
- whenever you press **Refresh** in the popup or the options page.

It is a plain `GET` with no parameters, no headers identifying you, and no body.
See [exchangerate-api.com's privacy policy](https://www.exchangerate-api.com/privacy)
for what they log at their end.

Country flags are bundled inside the extension as data URIs, so no image, font
or script is ever loaded from a third party while you browse. This is
deliberate: an image request made from a page would hand its host the address of
the page you were reading.

## Things the extension does on the page

- **Draws a tooltip** in a closed shadow root, so neither the page's styles nor
  its scripts can read or alter it.
- **Inline mode**, off by default: appends your currency next to a price. It
  never rewrites the site's own text, and it stays out of text fields, editable
  areas, `code` and `pre`.
- **Copies to your clipboard**, and only when you click a row in the tooltip.

## Changes

Any change to what is described here will be published in
[`CHANGELOG.md`](https://github.com/klNuno/PriceHover/blob/main/CHANGELOG.md)
and reflected in this document before the version that makes it is released.

## Contact

Open an issue at [github.com/klNuno/PriceHover](https://github.com/klNuno/PriceHover).
