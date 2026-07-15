import { Injectable, BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { OrderStatus } from "../../../common/constants/order-status.enum";

/**
 * PASS 3 of the payments.service refactor. Pure, stateless validation
 * seams lifted VERBATIM out of PaymentsService's create / splitBill /
 * payByItems orchestrators.
 *
 * Like PaymentMathCalculator, every method here is a deterministic
 * function of its inputs with ZERO external dependencies (no Prisma, no
 * tx, no side-effects). They throw the exact same exceptions (type,
 * message, ordering) the inline code did. PaymentsService STILL owns
 * every $transaction boundary and DB read; it passes the already-fetched
 * `order` shape into these guards and uses the small returned values.
 *
 * The single-source-of-truth ±1 kuruş rounding tolerance lives here too
 * so the split-bill exact-match check and the single-payment overpayment
 * check (which stays inline in create(), reading the remaining from a tx
 * aggregate) agree on the same literal.
 */
@Injectable()
export class PaymentValidator {
  // v2.8.97 — single source of truth for the cross-payment-path rounding
  // tolerance. Both the single-payment overpayment check and the
  // split-bill exact-match check accept ±1 kuruş for float-legacy callers
  // computing finalAmount client-side. Defining the value once means a
  // future audit/refactor doesn't have to chase two hardcoded literals.
  static readonly PAYMENT_TOLERANCE = new Prisma.Decimal("0.01");

  /**
   * The in-transaction order-state guards shared by create() and
   * payByItems() (byte-identical in both). Run AFTER the re-fetched
   * order is confirmed to exist, BEFORE any payment row is written or
   * the self-pay intent is consulted. Throws the exact BadRequestException
   * messages the inline code threw, in the same order:
   *   0. marketplace `source` set (settled by the platform — never POS-payable)
   *   1. already PAID
   *   2. CANCELLED
   *   3. requiresApproval && PENDING_APPROVAL
   */
  assertOrderPayable(order: {
    status: string;
    requiresApproval: boolean;
    source?: string | null;
  }): void {
    // Marketplace/delivery-platform orders are settled BY the platform: they
    // never create a Payment row (the platform owns the money rail — see
    // delivery-order.service). Taking a POS payment on one would double-charge
    // the customer AND fire a SECOND fiscal document (e-Arşiv/e-Fatura + ÖKC
    // receipt) on top of the platform's own. Gate on `source` (the marketplace:
    // YEMEKSEPETI/GETIR/TRENDYOL/MIGROS), NOT `type` — a restaurant's OWN
    // delivery (type=DELIVERY, source=null) is still POS-payable at the door.
    // Checked FIRST so the marketplace message surfaces regardless of status.
    if (order.source != null && order.source.trim() !== "") {
      throw new BadRequestException(
        "This is a marketplace/delivery-platform order — it is settled by the platform and cannot be paid through the POS.",
      );
    }

    // Check if order is already paid (inside transaction to prevent race condition)
    if (order.status === OrderStatus.PAID) {
      throw new BadRequestException("Order is already paid");
    }

    // Check if order is cancelled
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException("Cannot pay for a cancelled order");
    }

    // Prevent payment for orders awaiting approval (check BEFORE creating payment)
    if (
      order.requiresApproval &&
      order.status === OrderStatus.PENDING_APPROVAL
    ) {
      throw new BadRequestException(
        "Order requires approval before payment can be processed. Please approve the order first.",
      );
    }
  }

  /**
   * The split-bill amount-validation seam extracted verbatim from
   * splitBill(). Computes the remaining balance from the order's already-
   * completed payments and asserts the split total matches it within
   * ±PAYMENT_TOLERANCE (both directions). Returns `orderAmount` and
   * `remaining` (both still consumed downstream in splitBill — orderAmount
   * for the fully-paid compare + finalizeFullyPaid closing amount).
   *
   * Stays in Decimal until the final compare so a 0.005-per-line drift
   * over many split entries can't slip a real overpayment through.
   */
  validateSplitTotal(
    order: {
      finalAmount: Prisma.Decimal | number | string;
      payments: Array<{ amount: Prisma.Decimal | number | string }>;
    },
    dto: { payments: Array<{ amount: Prisma.Decimal | number | string }> },
  ): { orderAmount: Prisma.Decimal; remaining: Prisma.Decimal } {
    // Decimal-clean tolerance check. The earlier JS-Number implementation
    // accumulated rounding error: a 0.005-per-line drift over 20 split
    // entries could slip a real overpayment through (or block a legit
    // exact-cent split). Stay in Decimal until the final compare.
    const orderAmount = new Prisma.Decimal(order.finalAmount);
    const alreadyPaid = order.payments.reduce<Prisma.Decimal>(
      (sum, p) => sum.add(new Prisma.Decimal(p.amount)),
      new Prisma.Decimal(0),
    );
    const remaining = orderAmount.sub(alreadyPaid);

    const totalSplitAmount = dto.payments.reduce<Prisma.Decimal>(
      (sum, p) => sum.add(new Prisma.Decimal(p.amount)),
      new Prisma.Decimal(0),
    );

    // Split total must match the remaining amount within 1 kuruş — both
    // directions. The original implementation only rejected overpayment,
    // which let a 100.00 TL bill be settled as [50.00, 49.99] and silently
    // marked PAID with 0.01 TL outstanding — systematic revenue loss when
    // it happens at scale.
    const diff = totalSplitAmount.sub(remaining).abs();
    if (diff.gt(PaymentValidator.PAYMENT_TOLERANCE)) {
      const direction = totalSplitAmount.gt(remaining) ? "exceeds" : "is below";
      throw new BadRequestException(
        `Split total (${totalSplitAmount.toFixed(2)}) ${direction} remaining amount (${remaining.toFixed(2)})`,
      );
    }

    return { orderAmount, remaining };
  }

  /**
   * The payByItems item-membership + duplicate validation seam, extracted
   * verbatim. Builds the id→OrderItem map, asserts every requested entry
   * references a real OrderItem on this order, then rejects any duplicate
   * orderItemId in the same request (which would make residual-allocation
   * rounding ambiguous). Returns the map so the caller reuses it for the
   * quantity validation and allocation derivation that follow.
   */
  resolveItemsById<T extends { id: string }>(
    orderItems: T[],
    entries: Array<{ orderItemId: string }>,
  ): Map<string, T> {
    // Validate that every entry references a real OrderItem on this order.
    const itemsById = new Map(orderItems.map((i) => [i.id, i] as const));
    for (const entry of entries) {
      const item = itemsById.get(entry.orderItemId);
      if (!item) {
        throw new BadRequestException(
          `OrderItem ${entry.orderItemId} does not belong to this order`,
        );
      }
    }

    // Reject duplicate orderItemIds in the same request — would
    // make residual-allocation rounding ambiguous.
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.orderItemId)) {
        throw new BadRequestException(
          `Duplicate orderItemId ${entry.orderItemId} in items list — combine into one entry`,
        );
      }
      seen.add(entry.orderItemId);
    }

    return itemsById;
  }
}
