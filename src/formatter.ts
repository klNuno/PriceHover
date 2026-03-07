const FORMATTERS = new Map<string, Intl.NumberFormat>();

function getFormatter(code: string): Intl.NumberFormat {
  let formatter = FORMATTERS.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: code === 'JPY' || code === 'KRW' ? 0 : 2,
    });
    FORMATTERS.set(code, formatter);
  }
  return formatter;
}

export function formatCurrencyAmount(amount: number, code: string): string {
  try {
    return getFormatter(code).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}
