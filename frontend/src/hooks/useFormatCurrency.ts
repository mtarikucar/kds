import { useCallback } from 'react';
import { formatCurrency } from '../lib/utils';
import { useCurrency } from './useCurrency';

export const useFormatCurrency = () => {
  const currency = useCurrency();

  return useCallback(
    (amount: number) => {
      return formatCurrency(amount, currency);
    },
    [currency]
  );
};
