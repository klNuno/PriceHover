import type { Currency } from './types';

/**
 * The crypto assets the extension can convert, and nothing else about them.
 *
 * `id` is CoinGecko's own slug, which is not derivable from the ticker
 * (`avalanche-2`, `the-open-network`). The endpoint omits an unknown id
 * silently rather than failing, so a slug that changes upstream would remove an
 * asset with no error anywhere: `bun run crypto:check` exists to catch that.
 *
 * `decimals` is a ceiling, not a minimum. It is what the asset's unit price
 * makes meaningful in a tooltip 240 px wide, not what the chain stores: ether
 * has eighteen and no reader has ever wanted them. Amounts below one unit are
 * governed by the significant-digit floor in `formatter.ts`, not by this
 * number, so a small ceiling never rounds a small amount away.
 *
 * `flag` carries a glyph instead of a country: no crypto has a flag, and the
 * tooltip, the popup and the options page all fall back to that field's text
 * when there is no flag image, so nothing new had to be drawn, generated or
 * shipped. Assets without a widely printed glyph get a neutral mark rather
 * than their ticker, which the row already prints in the next column.
 */
export interface CryptoAsset extends Currency {
  id: string;
  decimals: number;
}

export const CRYPTO_ASSETS: CryptoAsset[] = [
  { code: 'BTC', id: 'bitcoin', name: 'Bitcoin', symbol: '₿', flag: '₿', decimals: 8 },
  { code: 'ETH', id: 'ethereum', name: 'Ethereum', symbol: 'Ξ', flag: 'Ξ', decimals: 6 },
  { code: 'XMR', id: 'monero', name: 'Monero', symbol: 'ɱ', flag: 'ɱ', decimals: 6 },
  { code: 'BNB', id: 'binancecoin', name: 'BNB', symbol: 'BNB', flag: '◈', decimals: 6 },
  { code: 'USDT', id: 'tether', name: 'Tether', symbol: '₮', flag: '₮', decimals: 2 },
  { code: 'USDC', id: 'usd-coin', name: 'USD Coin', symbol: 'USDC', flag: '◈', decimals: 2 },
  { code: 'XRP', id: 'ripple', name: 'XRP', symbol: 'XRP', flag: '◈', decimals: 4 },
  { code: 'SOL', id: 'solana', name: 'Solana', symbol: '◎', flag: '◎', decimals: 4 },
  { code: 'DOGE', id: 'dogecoin', name: 'Dogecoin', symbol: 'Ð', flag: 'Ð', decimals: 2 },
  { code: 'ADA', id: 'cardano', name: 'Cardano', symbol: 'ADA', flag: '◈', decimals: 4 },
  { code: 'TRX', id: 'tron', name: 'TRON', symbol: 'TRX', flag: '◈', decimals: 2 },
  { code: 'AVAX', id: 'avalanche-2', name: 'Avalanche', symbol: 'AVAX', flag: '◈', decimals: 4 },
  { code: 'LINK', id: 'chainlink', name: 'Chainlink', symbol: 'LINK', flag: '◈', decimals: 4 },
  { code: 'DOT', id: 'polkadot', name: 'Polkadot', symbol: 'DOT', flag: '◈', decimals: 4 },
  { code: 'LTC', id: 'litecoin', name: 'Litecoin', symbol: 'Ł', flag: 'Ł', decimals: 4 },
  { code: 'BCH', id: 'bitcoin-cash', name: 'Bitcoin Cash', symbol: 'BCH', flag: '◈', decimals: 4 },
  { code: 'XLM', id: 'stellar', name: 'Stellar', symbol: 'XLM', flag: '◈', decimals: 2 },
  { code: 'SHIB', id: 'shiba-inu', name: 'Shiba Inu', symbol: 'SHIB', flag: '◈', decimals: 0 },
  { code: 'UNI', id: 'uniswap', name: 'Uniswap', symbol: 'UNI', flag: '◈', decimals: 4 },
  { code: 'ATOM', id: 'cosmos', name: 'Cosmos', symbol: 'ATOM', flag: '◈', decimals: 4 },
  { code: 'ETC', id: 'ethereum-classic', name: 'Ethereum Classic', symbol: 'ETC', flag: '◈', decimals: 4 },
  { code: 'NEAR', id: 'near', name: 'NEAR Protocol', symbol: 'NEAR', flag: '◈', decimals: 4 },
  { code: 'APT', id: 'aptos', name: 'Aptos', symbol: 'APT', flag: '◈', decimals: 4 },
  { code: 'FIL', id: 'filecoin', name: 'Filecoin', symbol: 'FIL', flag: '◈', decimals: 4 },
];

export const CRYPTO_BY_CODE = new Map(CRYPTO_ASSETS.map((a) => [a.code, a]));

export const CRYPTO_CODES: string[] = CRYPTO_ASSETS.map((a) => a.code);

export const isCryptoCode = (code: string): boolean => CRYPTO_BY_CODE.has(code);

/** Every id the rate request asks for, in one comma-separated list. */
export const cryptoIds = (): string => CRYPTO_ASSETS.map((a) => a.id).join(',');
