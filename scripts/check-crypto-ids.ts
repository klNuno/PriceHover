/**
 * Asks the crypto endpoint for every id in `src/crypto.ts` and fails on any it
 * does not answer for.
 *
 * The endpoint omits an unknown id **silently**: no error, no field, HTTP 200.
 * A slug renamed upstream would therefore remove an asset from the extension
 * with nothing anywhere to say so, and the first sign would be a user asking
 * why their row disappeared. This is the only check that can catch it, and it
 * cannot run in CI, which has no business making network calls during a build.
 *
 * Run it by hand when adding an asset, and when a rate looks wrong:
 *   bun run crypto:check
 */
import { CRYPTO_ASSETS } from '../src/crypto';
import { cryptoRatesUrl } from '../src/rates';

const res = await fetch(cryptoRatesUrl());
if (!res.ok) {
  console.error(`HTTP ${res.status} from the crypto endpoint`);
  process.exit(1);
}

const prices = (await res.json()) as Record<string, { usd?: unknown }>;
const missing: string[] = [];
const unusable: string[] = [];

for (const asset of CRYPTO_ASSETS) {
  const price = prices[asset.id]?.usd;
  if (price === undefined) { missing.push(`${asset.code} (${asset.id})`); continue; }
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    unusable.push(`${asset.code} (${asset.id}): ${String(price)}`);
    continue;
  }
  console.log(`${asset.code.padEnd(5)} ${asset.id.padEnd(20)} $${price}`);
}

if (missing.length) console.error(`\nNo answer for: ${missing.join(', ')}`);
if (unusable.length) console.error(`\nUnusable price: ${unusable.join(', ')}`);
if (missing.length || unusable.length) process.exit(1);

console.log(`\n${CRYPTO_ASSETS.length} assets, all priced.`);
