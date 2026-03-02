import type { DetectedPrice } from './types';
import { SYMBOL_TO_CODE } from './currencies';

// Covers: $12.99, €12,99, 12.99 USD, USD 12.99, £12.99, ¥1,234, ₹1,234.56
const PRICE_REGEX =
  /(?:([$€£¥₹₩₦₱฿₺₽]|R\$|A\$|CA\$|S\$|HK\$|NZ\$|USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY|INR|KRW|BRL|MXN|SGD|HKD|NOK|SEK|DKK|PLN|CZK|HUF|RUB|TRY|ZAR|AED|SAR|NZD|THB|IDR|MYR|PHP)\s*([\d]{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,2})?)|([\d]{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,2})?)\s*([$€£¥₹₩₦₱฿₺₽]|R\$|A\$|CA\$|S\$|HK\$|NZ\$|USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY|INR|KRW|BRL|MXN|SGD|HKD|NOK|SEK|DKK|PLN|CZK|HUF|RUB|TRY|ZAR|AED|SAR|NZD|THB|IDR|MYR|PHP))/i;

// ISO 4217 codes that are also words — validate with word boundary
const ISO_CODES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'KRW',
  'BRL', 'MXN', 'SGD', 'HKD', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'HUF',
  'RUB', 'TRY', 'ZAR', 'AED', 'SAR', 'NZD', 'THB', 'IDR', 'MYR', 'PHP',
]);

function normalizeAmount(raw: string): number {
  let s = raw.replace(/\s/g, '');

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma > lastDot) {
    // Comma is the last separator — check if it's thousands or decimal
    // Exactly 3 digits after → thousands separator (3,500 → 3500)
    // 1 or 2 digits after → decimal comma (12,99 → 12.99)
    const digitsAfter = s.length - lastComma - 1;
    if (digitsAfter === 3) {
      s = s.replace(/,/g, ''); // thousands: 3,500 → 3500
    } else {
      s = s.replace(/\./g, '').replace(',', '.'); // decimal: 12,99 → 12.99
    }
  } else if (lastDot > lastComma) {
    // Dot is the last separator
    const digitsAfter = s.length - lastDot - 1;
    if (digitsAfter === 3) {
      s = s.replace(/\./g, ''); // thousands: 3.500 → 3500
    } else {
      s = s.replace(/,/g, ''); // decimal: 12.99 → 12.99
    }
  }

  return parseFloat(s);
}

function symbolToCode(symbol: string): string | null {
  const upper = symbol.toUpperCase();
  if (ISO_CODES.has(upper)) return upper;
  return SYMBOL_TO_CODE[symbol] ?? null;
}

/**
 * Walk up the DOM tree looking for Schema.org / data attributes that specify
 * price and currency more reliably than regex.
 */
function trySemanticDetection(element: Element): DetectedPrice | null {
  let el: Element | null = element;
  let amount: number | null = null;
  let currencyCode: string | null = null;

  for (let depth = 0; depth < 6 && el; depth++, el = el.parentElement) {
    // Schema.org itemprop
    if (el.hasAttribute('itemprop')) {
      const prop = el.getAttribute('itemprop');
      if (prop === 'price') {
        const content = el.getAttribute('content') ?? el.textContent ?? '';
        const parsed = parseFloat(content.replace(/[^\d.]/g, ''));
        if (!isNaN(parsed)) amount = parsed;
      }
      if (prop === 'priceCurrency') {
        const content = el.getAttribute('content') ?? el.textContent ?? '';
        currencyCode = content.trim().toUpperCase();
      }
    }

    // data-price attribute
    if (el.hasAttribute('data-price') && amount === null) {
      const parsed = parseFloat(el.getAttribute('data-price')!);
      if (!isNaN(parsed)) amount = parsed;
    }

    // data-currency attribute
    if (el.hasAttribute('data-currency') && currencyCode === null) {
      currencyCode = el.getAttribute('data-currency')!.trim().toUpperCase();
    }

    if (amount !== null && currencyCode !== null) {
      return { amount, currencyCode };
    }
  }

  return null;
}

/**
 * Extract price from a text string using regex.
 */
function tryRegexDetection(text: string): DetectedPrice | null {
  const match = PRICE_REGEX.exec(text);
  if (!match) return null;

  let symbolOrCode: string;
  let rawAmount: string;

  if (match[1] && match[2]) {
    // Symbol/code before amount
    symbolOrCode = match[1];
    rawAmount = match[2];
  } else if (match[3] && match[4]) {
    // Amount before symbol/code
    rawAmount = match[3];
    symbolOrCode = match[4];
  } else {
    return null;
  }

  const currencyCode = symbolToCode(symbolOrCode);
  if (!currencyCode) return null;

  const amount = normalizeAmount(rawAmount);
  if (isNaN(amount) || amount <= 0) return null;

  return { amount, currencyCode };
}

/**
 * Main detection function. Tries semantic HTML first, then regex on text.
 * Regex only runs on leaf nodes (no child elements) to avoid triggering on
 * container elements like <td> or <div> that wrap a price somewhere inside.
 */
export function detectPrice(element: Element): DetectedPrice | null {
  try {
    const semantic = trySemanticDetection(element);
    if (semantic) return semantic;

    // Skip regex on containers — user must hover the actual text node's element
    if (element.childElementCount > 0) return null;

    const text = element.textContent ?? '';
    return tryRegexDetection(text.trim());
  } catch {
    return null;
  }
}

/**
 * Detect price from a raw text string (for selection mode).
 */
export function detectPriceFromText(text: string): DetectedPrice | null {
  try {
    return tryRegexDetection(text.trim());
  } catch {
    return null;
  }
}
