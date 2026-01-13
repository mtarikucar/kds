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

export const formatCurrency = (
  amount: number,
  currency: string = 'TRY'
): string => {
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${amount.toFixed(2)}`;
};

export const formatCurrencyWithPeriod = (
  amount: number,
  currency: string = 'TRY',
  period: string
): string => {
  return `${formatCurrency(amount, currency)}/${period}`;
};
