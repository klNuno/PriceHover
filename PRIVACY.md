---
layout: default
title: Privacy Policy
---
# Privacy policy

**Last updated: 2026-08-01. Applies to version 2.1.0.**

## The short version

PriceHover contacts exactly one host, `open.er-api.com`, and asks it one
question: what are today's exchange rates. That request says nothing about you
or about the page you are on. Everything else happens on your machine:
detecting prices, converting them, drawing the tooltip.

There is one exception, and only if you ask for it: turning on crypto
conversion adds a second host, `api.coingecko.com`. It is off by default, your
browser asks before granting it, and nothing is sent there either. See
[Crypto](#crypto-if-you-turn-it-on) below.

There is no analytics, no telemetry, no error reporting, no account, and no
identifier of any kind.

## What is collected

Nothing is collected. For completeness, here is every piece of data the
extension touches and where it goes.

| Data | Where it goes |
|---|---|
| The text of pages you visit | Read in the page, never sent anywhere. Used to find prices. |
| The page's domain and `<html lang>` | Read in the page, never sent anywhere, never stored. Used to tell a Canadian `$` from an American one. |
| Your settings (currencies, rounding, hover delay, paused sites) | `chrome.storage.local` on your own machine. Never sent anywhere. |
| Exchange rates | Fetched from `open.er-api.com`, cached on your machine. |
| The address of the tab you are on | Read only in the popup, only while it is open, only to show you which site the pause switch applies to. Never stored, never sent. |

**No browsing history is kept.** The paused-sites list contains only the domains
you chose to pause, and nothing else is ever written to storage.

## Permissions, and why each one exists

| Permission | Why |
|---|---|
| Access to page content on all sites (`content_scripts: <all_urls>`) | A price can be on any page, so the detector has to run on any page. It reads text and, in inline mode, appends a label next to a price. It never sends page data anywhere. Your browser may describe this as "read and change all your data on all websites", which is the standard wording for any content script. |
| `storage` | Keep your settings between sessions. |
| `activeTab` | Show the current site's name in the popup so the pause switch can name it. Granted for one tab, only at the moment you click the extension icon, and never at rest. |
| `open.er-api.com` host access | Fetch exchange rates. The only network destination the extension has by default. |
| `api.coingecko.com` host access | **Optional, not granted at install.** Fetch crypto rates, and only while you have crypto conversion switched on. Turning the switch off gives the permission back. |

The extension deliberately does **not** ask for `tabs`, `alarms`,
`clipboardWrite`, `webRequest`, `history`, or `cookies`.

## Network requests

One, to `https://open.er-api.com/v6/latest/USD`:

- at most once every 24 hours, and
- whenever you press **Refresh** in the popup or the options page.

It is a plain `GET` with no parameters, no headers identifying you, and no body.
It is made by the extension's background worker, never from the page you are
reading: a request issued from a page carries that page's address, and this one
must not know it.
See [exchangerate-api.com's privacy policy](https://www.exchangerate-api.com/privacy)
for what they log at their end.

Country flags are bundled inside the extension as data URIs, so no image, font
or script is ever loaded from a third party while you browse. This is
deliberate: an image request made from a page would hand its host the address of
the page you were reading.

## Crypto, if you turn it on

Crypto conversion is off when you install the extension, and turning it on is
the only thing that changes any of the above.

- Your browser prompts you before it grants access to `api.coingecko.com`. If
  you decline, the switch stays off.
- The request is `GET https://api.coingecko.com/api/v3/simple/price` with a
  fixed list of assets. Like the fiat one, it is made by the background worker,
  carries no page data and no identifier, and it names no page you have visited.
- At most once an hour, and only when a crypto amount is actually in play:
  either a crypto row in your list, or a price written in crypto on a page you
  are reading. A session that meets neither makes no crypto request at all.
- Turning the switch back off removes the permission and deletes the cached
  crypto rates. Revoking it from your browser's own permissions panel does the
  same thing.

What that host learns is what any host learns from being asked a question: that
some browser asked, and when. It is told nothing about you, and nothing about
what you were reading. See
[CoinGecko's privacy policy](https://www.coingecko.com/en/privacy) for what they
log at their end.

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
