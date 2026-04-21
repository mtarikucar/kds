import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface TaxBreakdown {
  subtotalExcludingTax: number;
  taxAmount: number;
  totalIncludingTax: number;
  taxRate: number;
}

export interface OrderTaxSummary {
  items: Array<{
    productId: string;
    quantity: number;
    unitPriceExcTax: number;
    taxRate: number;
    taxAmount: number;
    subtotalIncTax: number;
  }>;
  taxBreakdown: Record<number, { taxableAmount: number; taxAmount: number }>;
  totalExcTax: number;
  totalTax: number;
  totalIncTax: number;
}

// Money math runs in Decimal so we never accumulate float drift across
// hundreds of order items. Consumers take `.toNumber()` at the boundary
// where the legacy API already returns `number`, but the accumulation
// inside this service is Decimal-clean.
type Money = Prisma.Decimal | number | string;
const D = (v: Money) => new Prisma.Decimal(v);
const round2 = (d: Prisma.Decimal): Prisma.Decimal =>
  d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

@Injectable()
export class TaxCalculationService {
  /**
   * Product prices are stored INCLUDING tax (KDV dahil).
   * This extracts the tax component from an inclusive price.
   */
  extractTax(priceIncTax: Money, taxRatePercent: number): TaxBreakdown {
    const price = D(priceIncTax);
    const rate = D(taxRatePercent).div(100);
    const subtotalExcludingTax = price.div(D(1).add(rate));
    const taxAmount = price.sub(subtotalExcludingTax);
    return {
      subtotalExcludingTax: round2(subtotalExcludingTax).toNumber(),
      taxAmount: round2(taxAmount).toNumber(),
      totalIncludingTax: D(priceIncTax).toNumber(),
      taxRate: taxRatePercent,
    };
  }

  /**
   * Calculate tax summary for an entire order.
   * Each item uses its product's tax rate.
   */
  calculateOrderTax(
    items: Array<{
      productId: string;
      quantity: number;
      unitPriceIncTax: Money;
      modifierTotalIncTax: Money;
      taxRate: number;
    }>,
  ): OrderTaxSummary {
    const taxBreakdown: Record<number, { taxableAmount: Prisma.Decimal; taxAmount: Prisma.Decimal }> = {};
    let totalExcTax = D(0);
    let totalTax = D(0);
    let totalIncTax = D(0);

    const itemResults = items.map((item) => {
      const quantity = D(item.quantity);
      const lineTotal = D(item.unitPriceIncTax)
        .add(D(item.modifierTotalIncTax))
        .mul(quantity);
      const rate = D(item.taxRate).div(100);
      const subtotalExcTax = lineTotal.div(D(1).add(rate));
      const taxAmount = lineTotal.sub(subtotalExcTax);

      if (!taxBreakdown[item.taxRate]) {
        taxBreakdown[item.taxRate] = { taxableAmount: D(0), taxAmount: D(0) };
      }
      taxBreakdown[item.taxRate].taxableAmount =
        taxBreakdown[item.taxRate].taxableAmount.add(subtotalExcTax);
      taxBreakdown[item.taxRate].taxAmount =
        taxBreakdown[item.taxRate].taxAmount.add(taxAmount);

      totalExcTax = totalExcTax.add(subtotalExcTax);
      totalTax = totalTax.add(taxAmount);
      totalIncTax = totalIncTax.add(lineTotal);

      const unitPriceExcTax = D(item.unitPriceIncTax).div(D(1).add(rate));
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPriceExcTax: round2(unitPriceExcTax).toNumber(),
        taxRate: item.taxRate,
        taxAmount: round2(taxAmount).toNumber(),
        subtotalIncTax: round2(lineTotal).toNumber(),
      };
    });

    const serializedBreakdown: Record<number, { taxableAmount: number; taxAmount: number }> = {};
    for (const [k, v] of Object.entries(taxBreakdown)) {
      serializedBreakdown[Number(k)] = {
        taxableAmount: round2(v.taxableAmount).toNumber(),
        taxAmount: round2(v.taxAmount).toNumber(),
      };
    }

    return {
      items: itemResults,
      taxBreakdown: serializedBreakdown,
      totalExcTax: round2(totalExcTax).toNumber(),
      totalTax: round2(totalTax).toNumber(),
      totalIncTax: round2(totalIncTax).toNumber(),
    };
  }
}
