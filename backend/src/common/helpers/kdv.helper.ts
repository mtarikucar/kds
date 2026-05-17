import { Prisma } from '@prisma/client';

export const DEFAULT_KDV_RATE = 0.2;

export interface KdvSplit {
  subtotal: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
}

/**
 * Reverse-engineer the KDV split for an already-gross amount. Plan prices
 * are stored and charged as KDV-inclusive, so the invoice line items have
 * to derive the net + tax from the total: subtotal = total / (1 + rate),
 * tax = total - subtotal. Subtracting guarantees subtotal + tax == total
 * to the cent, regardless of rounding choices.
 */
export function splitGrossAmount(
  gross: Prisma.Decimal | number | string,
  rate: number = DEFAULT_KDV_RATE,
): KdvSplit {
  const total = new Prisma.Decimal(gross).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const subtotal = total
    .div(1 + rate)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const tax = total.sub(subtotal);
  return { subtotal, tax, total };
}
