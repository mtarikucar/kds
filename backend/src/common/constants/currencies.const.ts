export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'TRY', 'CAD', 'AUD'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_INFO: Record<SupportedCurrency, { name: string; symbol: string }> = {
  USD: { name: 'US Dollar', symbol: '$' },
  EUR: { name: 'Euro', symbol: '€' },
  GBP: { name: 'British Pound', symbol: '£' },
  TRY: { name: 'Turkish Lira', symbol: '₺' },
  CAD: { name: 'Canadian Dollar', symbol: 'C$' },
  AUD: { name: 'Australian Dollar', symbol: 'A$' },
};

export const DEFAULT_CURRENCY: SupportedCurrency = 'TRY';
