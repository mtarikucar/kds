import { Injectable } from '@nestjs/common';

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

@Injectable()
export class TaxCalculationService {
  /**
   * Product prices are stored INCLUDING tax (KDV dahil).
   * This extracts the tax component from an inclusive price.
   */
  extractTax(priceIncTax: number, taxRatePercent: number): TaxBreakdown {
    const rate = taxRatePercent / 100;
    const subtotalExcludingTax = priceIncTax / (1 + rate);
    const taxAmount = priceIncTax - subtotalExcludingTax;

    return {
      subtotalExcludingTax: Math.round(subtotalExcludingTax * 100) / 100,
      taxAmount: Math.round(taxAmount * 100) / 100,
      totalIncludingTax: priceIncTax,
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
      unitPriceIncTax: number;
      modifierTotalIncTax: number;
      taxRate: number;
    }>,
  ): OrderTaxSummary {
    const taxBreakdown: Record<number, { taxableAmount: number; taxAmount: number }> = {};
    let totalExcTax = 0;
    let totalTax = 0;
    let totalIncTax = 0;

    const itemResults = items.map((item) => {
      const lineTotal = item.quantity * (item.unitPriceIncTax + item.modifierTotalIncTax);
      const tax = this.extractTax(lineTotal, item.taxRate);

      if (!taxBreakdown[item.taxRate]) {
        taxBreakdown[item.taxRate] = { taxableAmount: 0, taxAmount: 0 };
      }
      taxBreakdown[item.taxRate].taxableAmount += tax.subtotalExcludingTax;
      taxBreakdown[item.taxRate].taxAmount += tax.taxAmount;

      totalExcTax += tax.subtotalExcludingTax;
      totalTax += tax.taxAmount;
      totalIncTax += lineTotal;

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPriceExcTax: Math.round((item.unitPriceIncTax / (1 + item.taxRate / 100)) * 100) / 100,
        taxRate: item.taxRate,
        taxAmount: tax.taxAmount,
        subtotalIncTax: lineTotal,
      };
    });

    return {
      items: itemResults,
      taxBreakdown,
      totalExcTax: Math.round(totalExcTax * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      totalIncTax: Math.round(totalIncTax * 100) / 100,
    };
  }
}
