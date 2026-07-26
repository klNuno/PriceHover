import type { Currency } from './types';

export const CURRENCIES: Currency[] = [
  { code: 'USD', symbol: '$', flag: '🇺🇸', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', flag: '🇪🇺', name: 'Euro' },
  { code: 'GBP', symbol: '£', flag: '🇬🇧', name: 'British Pound' },
  { code: 'JPY', symbol: '¥', flag: '🇯🇵', name: 'Japanese Yen' },
  { code: 'CAD', symbol: 'CA$', flag: '🇨🇦', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', flag: '🇦🇺', name: 'Australian Dollar' },
  { code: 'CHF', symbol: 'Fr', flag: '🇨🇭', name: 'Swiss Franc' },
  { code: 'CNY', symbol: '¥', flag: '🇨🇳', name: 'Chinese Yuan' },
  { code: 'INR', symbol: '₹', flag: '🇮🇳', name: 'Indian Rupee' },
  { code: 'KRW', symbol: '₩', flag: '🇰🇷', name: 'South Korean Won' },
  { code: 'BRL', symbol: 'R$', flag: '🇧🇷', name: 'Brazilian Real' },
  { code: 'MXN', symbol: 'MX$', flag: '🇲🇽', name: 'Mexican Peso' },
  { code: 'SGD', symbol: 'S$', flag: '🇸🇬', name: 'Singapore Dollar' },
  { code: 'HKD', symbol: 'HK$', flag: '🇭🇰', name: 'Hong Kong Dollar' },
  { code: 'NOK', symbol: 'kr', flag: '🇳🇴', name: 'Norwegian Krone' },
  { code: 'SEK', symbol: 'kr', flag: '🇸🇪', name: 'Swedish Krona' },
  { code: 'DKK', symbol: 'kr', flag: '🇩🇰', name: 'Danish Krone' },
  { code: 'ISK', symbol: 'kr', flag: '🇮🇸', name: 'Icelandic Króna' },
  { code: 'PLN', symbol: 'zł', flag: '🇵🇱', name: 'Polish Złoty' },
  { code: 'CZK', symbol: 'Kč', flag: '🇨🇿', name: 'Czech Koruna' },
  { code: 'HUF', symbol: 'Ft', flag: '🇭🇺', name: 'Hungarian Forint' },
  { code: 'RUB', symbol: '₽', flag: '🇷🇺', name: 'Russian Ruble' },
  { code: 'TRY', symbol: '₺', flag: '🇹🇷', name: 'Turkish Lira' },
  { code: 'ZAR', symbol: 'R', flag: '🇿🇦', name: 'South African Rand' },
  { code: 'AED', symbol: 'د.إ', flag: '🇦🇪', name: 'UAE Dirham' },
  { code: 'SAR', symbol: '﷼', flag: '🇸🇦', name: 'Saudi Riyal' },
  { code: 'NZD', symbol: 'NZ$', flag: '🇳🇿', name: 'New Zealand Dollar' },
  { code: 'THB', symbol: '฿', flag: '🇹🇭', name: 'Thai Baht' },
  { code: 'IDR', symbol: 'Rp', flag: '🇮🇩', name: 'Indonesian Rupiah' },
  { code: 'MYR', symbol: 'RM', flag: '🇲🇾', name: 'Malaysian Ringgit' },
  { code: 'PHP', symbol: '₱', flag: '🇵🇭', name: 'Philippine Peso' },
  { code: 'UAH', symbol: '₴', flag: '🇺🇦', name: 'Ukrainian Hryvnia' },
  { code: 'VND', symbol: '₫', flag: '🇻🇳', name: 'Vietnamese Dong' },
  { code: 'KZT', symbol: '₸', flag: '🇰🇿', name: 'Kazakhstani Tenge' },
  { code: 'ILS', symbol: '₪', flag: '🇮🇱', name: 'Israeli Shekel' },
  { code: 'CRC', symbol: '₡', flag: '🇨🇷', name: 'Costa Rican Colón' },
  { code: 'UYU', symbol: '$U', flag: '🇺🇾', name: 'Uruguayan Peso' },
  { code: 'PEN', symbol: 'S/.', flag: '🇵🇪', name: 'Peruvian Sol' },
  { code: 'KWD', symbol: 'KD', flag: '🇰🇼', name: 'Kuwaiti Dinar' },
  { code: 'QAR', symbol: 'QR', flag: '🇶🇦', name: 'Qatari Riyal' },
  { code: 'COP', symbol: 'COL$', flag: '🇨🇴', name: 'Colombian Peso' },
  { code: 'CLP', symbol: 'CLP$', flag: '🇨🇱', name: 'Chilean Peso' },
  { code: 'TWD', symbol: 'NT$', flag: '🇹🇼', name: 'Taiwan Dollar' },
  { code: 'NGN', symbol: '₦', flag: '🇳🇬', name: 'Nigerian Naira' },
];

export const CURRENCY_BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

// Extract 2-letter country code from a flag emoji (Regional Indicator Symbol pair)
// e.g. '🇺🇸' → 'us', '🇪🇺' → 'eu'
export function flagToCountryCode(flag: string): string {
  return [...flag].slice(0, 2)
    .map(c => String.fromCharCode(c.codePointAt(0)! - 0x1F1A5).toLowerCase())
    .join('');
}

// Detection symbols and their positional rules live in detector.ts, next to the
// regex that consumes them.
//
// Several tokens are shared by more than one country: 'kr' by SEK, NOK, DKK and
// ISK, '$' by a dozen currencies, '¥' by JPY and CNY. Each has a default reading
// here, and locale.ts overrides it from the page's ccTLD or `<html lang>` region.
