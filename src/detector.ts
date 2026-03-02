import type { DetectedPrice } from './types';
import { SYMBOL_TO_CODE } from './currencies';

// Multi-char symbols must come BEFORE single-char to win in alternation.
const SYM =
  // Multi-char dollar variants (longest first)
  'CA\\$|HK\\$|NZ\\$|A\\$|R\\$|S\\$|' +
  // Other multi-char symbols
  'S/\\.|\\$U|' +                               // PEN (S/.), UYU ($U)
  'Rp|RM|SR|QR|KD|kr|zł|R|' +                  // IDR, MYR, SAR, QAR, KWD, SEK/NOK/DKK, PLN, ZAR
  // ISO 4217 codes
  'USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY|INR|KRW|' +
  'BRL|MXN|SGD|HKD|NOK|SEK|DKK|PLN|CZK|HUF|' +
  'RUB|TRY|ZAR|AED|SAR|NZD|THB|IDR|MYR|PHP|' +
  'UAH|VND|KZT|ILS|CRC|UYU|PEN|KWD|QAR|' +
  // Single-char symbols
  '[$€£¥₹₩₦₱฿₺₽₴₫₸₪₡]';

// Two alternatives:
// 1. Formatted with separators: 1,234.56 / 1.234,56 / 1 234,56
// 2. Plain digit run: 746000 / 22000 (no internal separators — common in VND, IDR, KZT…)
const AMOUNT =
  '(?:[\\d]{1,3}(?:[,\\.\\s]\\d{3})+(?:[,\\.]\\d{1,2})?|[\\d]+(?:[,\\.]\\d{1,2})?)';

const PRICE_REGEX = new RegExp(
  `(?:(${SYM})\\s*(${AMOUNT})|(${AMOUNT})\\s*(${SYM}))`,
  'i'
);

const ISO_CODES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'KRW',
  'BRL', 'MXN', 'SGD', 'HKD', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'HUF',
  'RUB', 'TRY', 'ZAR', 'AED', 'SAR', 'NZD', 'THB', 'IDR', 'MYR', 'PHP',
  'UAH', 'VND', 'KZT', 'ILS', 'CRC', 'UYU', 'PEN', 'KWD', 'QAR',
]);

function normalizeAmount(raw: string): number {
  let s = raw.replace(/\s/g, '');

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma > lastDot) {
    const digitsAfter = s.length - lastComma - 1;
    if (digitsAfter === 3) {
      s = s.replace(/,/g, '');           // 3,500 → 3500
    } else {
      s = s.replace(/\./g, '').replace(',', '.'); // 12,99 → 12.99
    }
  } else if (lastDot > lastComma) {
    const digitsAfter = s.length - lastDot - 1;
    if (digitsAfter === 3) {
      s = s.replace(/\./g, '');          // 3.500 → 3500
    } else {
      s = s.replace(/,/g, '');           // 12.99 → 12.99
    }
  }

  return parseFloat(s);
}

function symbolToCode(symbol: string): string | null {
  const upper = symbol.toUpperCase();
  if (ISO_CODES.has(upper)) return upper;
  return SYMBOL_TO_CODE[symbol] ?? SYMBOL_TO_CODE[upper] ?? null;
}

function trySemanticDetection(element: Element): DetectedPrice | null {
  let el: Element | null = element;
  let amount: number | null = null;
  let currencyCode: string | null = null;

  for (let depth = 0; depth < 6 && el; depth++, el = el.parentElement) {
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
    if (el.hasAttribute('data-price') && amount === null) {
      const parsed = parseFloat(el.getAttribute('data-price')!);
      if (!isNaN(parsed)) amount = parsed;
    }
    if (el.hasAttribute('data-currency') && currencyCode === null) {
      currencyCode = el.getAttribute('data-currency')!.trim().toUpperCase();
    }
    if (amount !== null && currencyCode !== null) return { amount, currencyCode };
  }

  return null;
}

function tryRegexDetection(text: string): DetectedPrice | null {
  const match = PRICE_REGEX.exec(text);
  if (!match) return null;

  let symbolOrCode: string;
  let rawAmount: string;

  if (match[1] && match[2]) {
    symbolOrCode = match[1];
    rawAmount = match[2];
  } else if (match[3] && match[4]) {
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
 * Get text from direct text nodes only (excludes child element text).
 * Handles cases like <td><span>-20%</span> ¥ 159.71</td> where the price
 * is in a text node alongside child elements.
 */
function directTextContent(element: Element): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  }
  return text.trim();
}

export function detectPrice(element: Element): DetectedPrice | null {
  try {
    const semantic = trySemanticDetection(element);
    if (semantic) return semantic;

    // Leaf node: use full textContent
    if (element.childElementCount === 0) {
      return tryRegexDetection((element.textContent ?? '').trim());
    }

    // Element with children: only check direct text nodes, and only when
    // the direct text is short (≤ 30 chars). Long text means the price is
    // embedded in a sentence — the hitbox would cover the entire element.
    const direct = directTextContent(element);
    if (!direct || direct.length > 30) return null;
    return tryRegexDetection(direct);
  } catch {
    return null;
  }
}

export function detectPriceFromText(text: string): DetectedPrice | null {
  try {
    return tryRegexDetection(text.trim());
  } catch {
    return null;
  }
}
