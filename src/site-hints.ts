import { FAMILIES, familyOfCode } from './families';
import type { FamilyChoice } from './families';
import { normalizeHostname } from './settings';
import { STORAGE } from './types';

/**
 * What pages of a site said about their own currency, remembered for the site.
 *
 * A shop that prints `$` everywhere names its currency once, in a picker or a
 * checkout line, and rarely on the page the user happens to be reading. The
 * page that did say it is what this keeps, so the next page of the same site
 * reads its `$` the same way.
 *
 * Local only, like everything else the extension stores. It is still a list of
 * sites, which is why it is bounded, why the options page shows it and lets
 * each entry go, and why a private window never writes to it.
 */

/** `c`: the reading per family. `t`: when a page last said so, for pruning. */
export interface SiteHint {
  c: FamilyChoice;
  t: number;
}

export type SiteHints = Record<string, SiteHint>;

/** Oldest first out. A site not visited in a while re-learns on its next page. */
export const MAX_SITE_HINTS = 300;

function parseChoice(value: unknown): FamilyChoice {
  const out: FamilyChoice = {};
  if (!value || typeof value !== 'object') return out;
  for (const family of FAMILIES) {
    const code = (value as Record<string, unknown>)[family];
    if (typeof code === 'string' && familyOfCode(code) === family) out[family] = code;
  }
  return out;
}

/** Accepts anything, like `parseSettings`, and drops what it cannot use. */
export function parseSiteHints(raw: unknown): SiteHints {
  const out: SiteHints = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [host, entry] of Object.entries(raw)) {
    const key = normalizeHostname(host);
    // `__proto__` as a plain assignment would replace the prototype instead.
    if (!key || key === '__proto__' || !entry || typeof entry !== 'object') continue;
    const c = parseChoice((entry as SiteHint).c);
    const t = Number((entry as SiteHint).t);
    if (Object.keys(c).length) out[key] = { c, t: Number.isFinite(t) ? t : 0 };
  }
  return out;
}

/**
 * The hints with this site's choice merged in, or `null` when that changes
 * nothing. A family the page did not speak about keeps what an earlier page
 * said; one it did speak about takes the newer answer.
 */
export function withSiteHint(
  hints: SiteHints,
  hostname: string,
  choice: FamilyChoice,
  now: number
): SiteHints | null {
  const host = normalizeHostname(hostname);
  if (!host || !Object.keys(choice).length) return null;
  const previous = Object.hasOwn(hints, host) ? hints[host].c : {};
  const merged = { ...previous, ...choice };
  if (FAMILIES.every((family) => merged[family] === previous[family])) return null;

  const next: SiteHints = { ...hints, [host]: { c: merged, t: now } };
  const hosts = Object.keys(next);
  if (hosts.length > MAX_SITE_HINTS) {
    hosts
      .sort((a, b) => next[a].t - next[b].t)
      .slice(0, hosts.length - MAX_SITE_HINTS)
      .forEach((stale) => delete next[stale]);
  }
  return next;
}

export async function readSiteHints(): Promise<SiteHints> {
  const stored = await chrome.storage.local.get(STORAGE.SITE_HINTS);
  return parseSiteHints(stored?.[STORAGE.SITE_HINTS]);
}

export async function readSiteHint(hostname: string): Promise<FamilyChoice> {
  const host = normalizeHostname(hostname);
  const hints = await readSiteHints();
  return Object.hasOwn(hints, host) ? hints[host].c : {};
}

/**
 * Saves what a page said. Returns the site's merged choice when it changed, so
 * the caller knows to re-read the page, or `null` when it did not.
 *
 * Two tabs of two sites learning in the same instant can lose one of the two
 * writes. That costs one re-learn on the next page of that site, which is not
 * worth a lock.
 */
export async function rememberSiteHint(hostname: string, choice: FamilyChoice): Promise<FamilyChoice | null> {
  const hints = await readSiteHints();
  const next = withSiteHint(hints, hostname, choice, Date.now());
  if (!next) return null;
  await chrome.storage.local.set({ [STORAGE.SITE_HINTS]: next });
  return next[normalizeHostname(hostname)].c;
}

export async function forgetSiteHint(hostname: string): Promise<void> {
  const hints = await readSiteHints();
  const host = normalizeHostname(hostname);
  if (!Object.hasOwn(hints, host)) return;
  delete hints[host];
  await chrome.storage.local.set({ [STORAGE.SITE_HINTS]: hints });
}

export async function forgetAllSiteHints(): Promise<void> {
  await chrome.storage.local.remove(STORAGE.SITE_HINTS);
}
