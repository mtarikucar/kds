import { Injectable } from "@nestjs/common";
import { TaxCalculationService } from "../../accounting/services/tax-calculation.service";
import {
  resolveEffectivePrice,
  isCampaignActive,
  CampaignPricable,
} from "./combo-pricing";

/**
 * Pure line-item pricing/totals/tax computation, extracted VERBATIM from the
 * identical block that createInner() and update() shared in OrdersService
 * (wave-d2 god-file split). Zero DB / transaction involvement — given the
 * already-validated DTO items plus the server-side product/modifier maps, it
 * deterministically produces the nested-`create` OrderItem rows and the
 * running totals. OrdersService keeps owning every $transaction boundary,
 * validation, and the discount POLICY (create throws on over-discount;
 * update caps via Math.min) — only the shared math moved here.
 *
 * Money note: prices are KDV-INCLUSIVE. `subtotal = qty * (price +
 * modifierTotal)`; per-line `taxAmount` is *extracted* from that subtotal via
 * TaxCalculationService.extractTax (only when a tax service is supplied — the
 * caller may construct OrdersService without one, in which case taxAmount
 * stays 0 exactly as before). Caller passes its own (optionally undefined)
 * tax service so behaviour is identical to the inlined version.
 */
export interface PricingItemInput {
  productId: string;
  quantity: number;
  notes?: string;
  modifiers?: Array<{ modifierId: string; quantity: number }>;
}

export interface PricedOrderItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  modifierTotal: number;
  taxRate: number;
  taxAmount: number;
  notes: string | undefined;
  // Set ONLY when a campaign discount is active: the pre-discount catalog unit
  // price, so the receipt/analytics can show "was X". undefined otherwise —
  // Jest toEqual ignores undefined keys so existing specs are unaffected.
  listUnitPrice?: number;
  modifiers?: {
    create: Array<{
      modifierId: string;
      quantity: number;
      priceAdjustment: number;
    }>;
  };
}

export interface PricingResult {
  orderItems: PricedOrderItem[];
  totalAmount: number;
  totalTaxAmount: number;
}

@Injectable()
export class OrderPricingCalculator {
  /**
   * Compute priced order-item rows + running totals. `productMap` and
   * `modifierMap` are the server-side, already-validated catalog lookups
   * (never trust client prices). `taxCalculationService` is optional to
   * mirror OrdersService's `@Optional()` injection — when absent, per-line
   * taxAmount is 0 and totalTaxAmount stays 0, byte-for-byte as before.
   */
  priceItems(
    items: ReadonlyArray<PricingItemInput>,
    productMap: Map<
      string,
      { price: unknown; taxRate?: number | null } & Partial<CampaignPricable>
    >,
    modifierMap: Map<string, { priceAdjustment: unknown }>,
    taxCalculationService?: Pick<TaxCalculationService, "extractTax">,
    now: Date = new Date(),
  ): PricingResult {
    let totalAmount = 0;
    let totalTaxAmount = 0;
    const orderItems = items.map((item) => {
      const product = productMap.get(item.productId);
      // Campaign-aware SINGLE source of truth: the charged price is the active
      // campaign price when its window is open, else the list price. Identical
      // to Number(product.price) for products without a campaign.
      const serverPrice = resolveEffectivePrice(product ?? { price: 0 }, now);
      const listUnitPrice =
        product && isCampaignActive(product, now)
          ? Number(product.price)
          : undefined;
      const taxRate = product?.taxRate ?? 10;

      // Calculate modifier total for this item
      let modifierTotal = 0;
      const itemModifiers = (item.modifiers || []).map((mod) => {
        const modifier = modifierMap.get(mod.modifierId);
        const priceAdjustment = Number(modifier?.priceAdjustment || 0);
        modifierTotal += priceAdjustment * mod.quantity;
        return {
          modifierId: mod.modifierId,
          quantity: mod.quantity,
          priceAdjustment,
        };
      });

      const subtotal = item.quantity * (serverPrice + modifierTotal);
      totalAmount += subtotal;

      // Calculate tax for this line item (prices are KDV-inclusive)
      let itemTaxAmount = 0;
      if (taxCalculationService) {
        const tax = taxCalculationService.extractTax(subtotal, taxRate);
        itemTaxAmount = tax.taxAmount;
        totalTaxAmount += itemTaxAmount;
      }

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: serverPrice,
        subtotal,
        modifierTotal,
        taxRate,
        taxAmount: itemTaxAmount,
        notes: item.notes,
        listUnitPrice,
        modifiers:
          itemModifiers.length > 0 ? { create: itemModifiers } : undefined,
      };
    });

    return { orderItems, totalAmount, totalTaxAmount };
  }
}
