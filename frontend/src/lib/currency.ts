const CURRENCY_SYMBOLS: Record<string, string> = {
  TRY: '₺',
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'C$',
  AUD: 'A$',
};

export const getCurrencySymbol = (currency: string = 'TRY'): string => {
  return CURRENCY_SYMBOLS[currency] || currency;
};

// deep-review FM12: render money with Turkish grouping/decimals (₺2.999,00) to
// match the app-wide lib/utils.formatCurrency, instead of the divergent
// US-style `${symbol}${toFixed(2)}` (₺2999.00) that leaked onto the
// subscription/billing screens. The leading symbol is kept (rather than
// Intl `style:'currency'`) so the output prefix stays consistent with the
// rest of these screens and callers that pair it with an explicit ISO code.
export const formatCurrency = (
  amount: number,
  currency: string = 'TRY'
): string => {
  const symbol = getCurrencySymbol(currency);
  const formatted = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${symbol}${formatted}`;
};

export const formatCurrencyWithPeriod = (
  amount: number,
  currency: string = 'TRY',
  period: string
): string => {
  return `${formatCurrency(amount, currency)}/${period}`;
};
