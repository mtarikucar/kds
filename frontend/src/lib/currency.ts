import {
  CURRENCY_DISPLAY,
  MONEY_LOCALE,
  formatCurrencyWithOwnSymbol,
} from './utils';

// The billing/subscription rail. Symbol and precision come from the ONE table
// in lib/utils.ts (CURRENCY_DISPLAY) so a currency added there is right here
// too; only the PLACEMENT policy below is this rail's own.
export const getCurrencySymbol = (currency: string = 'TRY'): string => {
  // An unknown currency prints its ISO code — a readable code beats a wrong
  // glyph, and it is what these screens showed before the table existed.
  return CURRENCY_DISPLAY[currency]?.symbol ?? currency;
};

// deep-review FM12: render money with Turkish grouping/decimals (₺2.999,00) to
// match the app-wide lib/utils.formatCurrency, instead of the divergent
// US-style `${symbol}${toFixed(2)}` (₺2999.00) that leaked onto the
// subscription/billing screens. Our own symbol is kept (rather than Intl
// `style:'currency'`) so the output prefix stays consistent with the rest of
// these screens and callers that pair it with an explicit ISO code — but WHICH
// symbol, on which side, and with how many decimals is no longer this file's
// private opinion: it is CURRENCY_DISPLAY's. That is what stopped UZS from
// rendering here as "UZS1.234.567,89" while the QR menu said "1.234.568 so'm".
export const formatCurrency = (
  amount: number,
  currency: string = 'TRY'
): string => {
  return formatCurrencyWithOwnSymbol(MONEY_LOCALE, amount, currency);
};

export const formatCurrencyWithPeriod = (
  amount: number,
  currency: string = 'TRY',
  period: string
): string => {
  return `${formatCurrency(amount, currency)}/${period}`;
};
