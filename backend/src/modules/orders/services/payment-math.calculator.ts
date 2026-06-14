import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/**
 * Pure per-item payment math, extracted verbatim from PaymentsService
 * (PASS 1 of the payments.service refactor). Zero dependencies — every
 * method is a deterministic Decimal computation over OrderItem / Order
 * shapes, so it's trivially unit-testable in isolation and shared by the
 * progressive (per-item) payment path, the customer self-pay amount
 * pre-compute, and the payable-items read.
 *
 * NOTE on tax: prices in this codebase are KDV-INCLUSIVE
 * (orders.service.ts:190-198 — `subtotal = qty * (price + modifierTotal)`,
 * then `taxAmount` is *extracted* from that subtotal via
 * `taxCalculationService.extractTax`). So `subtotal` already contains
 * both modifier value and tax — we MUST NOT add `taxAmount` or
 * `modifierTotal` on top, or every per-item payment overstates by
 * the embedded tax (and double-counts modifiers).
 * Likewise `order.totalAmount = sum(orderItem.subtotal)`.
 */
@Injectable()
export class PaymentMathCalculator {
  /**
   * Discount-adjusted per-unit value of an OrderItem
   * (subtotal/quantity × discountMultiplier). Caller scales by qty.
   *
   * Used by the customer self-pay path (QR-menu PayTR flow) to compute
   * the amount it will charge before requesting a PayTR token, mirroring
   * the per-unit math used inside payByItems so the server-side amount is
   * consistent across staff and customer payment paths.
   */
  derivePerUnitNet(
    item: { quantity: number; subtotal: Prisma.Decimal | number | string },
    order: {
      discount: Prisma.Decimal | number | string;
      totalAmount: Prisma.Decimal | number | string;
    },
  ): Prisma.Decimal {
    return this.perUnitGross(item).mul(this.discountMultiplier(order));
  }

  perUnitGross(item: {
    quantity: number;
    subtotal: Prisma.Decimal | number | string;
  }): Prisma.Decimal {
    if (item.quantity <= 0) return new Prisma.Decimal(0);
    return new Prisma.Decimal(item.subtotal).div(item.quantity);
  }

  /**
   * Order-level discount multiplier so per-item math distributes the
   * discount pro-rata across line items. `order.discount` is the only
   * order-level discount today; it applies against `order.totalAmount`
   * (pre-discount). Returns `1 - discount/totalAmount`, clamped to [0,1].
   */
  discountMultiplier(order: {
    discount: Prisma.Decimal | number | string;
    totalAmount: Prisma.Decimal | number | string;
  }): Prisma.Decimal {
    const totalAmount = new Prisma.Decimal(order.totalAmount);
    if (totalAmount.lte(0)) return new Prisma.Decimal(1);
    const ratio = new Prisma.Decimal(order.discount).div(totalAmount);
    const factor = new Prisma.Decimal(1).sub(ratio);
    if (factor.lt(0)) return new Prisma.Decimal(0);
    if (factor.gt(1)) return new Prisma.Decimal(1);
    return factor;
  }

  /**
   * Discount-adjusted total for an OrderItem (all units). See the tax
   * note on the class — `subtotal` is the authoritative total value of
   * the item (KDV-inclusive, modifier-inclusive).
   */
  itemTotalWithDiscount(
    item: { subtotal: Prisma.Decimal | number | string },
    order: {
      discount: Prisma.Decimal | number | string;
      totalAmount: Prisma.Decimal | number | string;
    },
  ): Prisma.Decimal {
    return new Prisma.Decimal(item.subtotal).mul(
      this.discountMultiplier(order),
    );
  }
}
