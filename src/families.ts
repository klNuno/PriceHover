import { CURRENCY_BY_CODE } from './currencies';

/**
 * The tokens that mean different currencies in different places, and every
 * currency each of them can stand for.
 *
 * Its own module because two sides need it and neither may import the other:
 * `detector.ts` has to know which tokens are ambiguous to tell `$49 CAD` from
 * `$49`, and `locale.ts` decides what an ambiguous token reads as.
 */

export type Family = '$' | 'kr' | '¥';

export const FAMILIES: readonly Family[] = ['$', 'kr', '¥'];

export const FAMILY_BY_TOKEN = new Map<string, Family>([
  ['$', '$'],
  ['kr', 'kr'], ['kr.', 'kr'], ['Kr', 'kr'],
  ['¥', '¥'], ['￥', '¥'],
]);

/** What a family token reads as when nothing on the page says otherwise. */
export const FAMILY_DEFAULT: Record<Family, string> = { '$': 'USD', kr: 'SEK', '¥': 'JPY' };

/**
 * Region → currency, per family. A region absent from a family's table leaves
 * the token at its default reading, so an unlisted country never makes things
 * worse than they are today.
 */
export const REGION_CURRENCY: Record<Family, Record<string, string>> = {
  '$': {
    US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD',
    MX: 'MXN', CL: 'CLP', UY: 'UYU', TW: 'TWD', BR: 'BRL',
  },
  kr: { SE: 'SEK', NO: 'NOK', DK: 'DKK', IS: 'ISK' },
  '¥': { JP: 'JPY', CN: 'CNY' },
};

/** Every currency a family can stand for, its default first. */
export const FAMILY_CODES: Record<Family, string[]> = Object.fromEntries(
  FAMILIES.map((family) => [
    family,
    [...new Set([FAMILY_DEFAULT[family], ...Object.values(REGION_CURRENCY[family])])]
      .filter((code) => CURRENCY_BY_CODE.has(code)),
  ])
) as Record<Family, string[]>;

const FAMILY_BY_CODE = new Map<string, Family>(
  FAMILIES.flatMap((family) => FAMILY_CODES[family].map((code) => [code, family] as const))
);

/** `STRIPPABLE_SPACE` lives in the detector; a qualified token may carry one. */
export function familyOfToken(token: string): Family | null {
  return FAMILY_BY_TOKEN.get(token.replace(/\s/g, '')) ?? null;
}

export function familyOfCode(code: string): Family | null {
  return FAMILY_BY_CODE.get(code) ?? null;
}

/** A reading per family, for whichever families something had an opinion on. */
export type FamilyChoice = Partial<Record<Family, string>>;
