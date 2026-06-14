import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { selfPayError } from "./self-pay-pricing.util";

/**
 * Sum of orderItem units held by other PENDING intents on the same
 * order. A second customer (or the waiter) cannot pay those units
 * until the first intent terminates (SUCCEEDED / FAILED / EXPIRED).
 * Without this, both phones can charge the same item via PayTR and
 * the second webhook silently drops because payByItems sees "0
 * remaining" — money taken on PayTR, no Payment row, no auto-refund.
 *
 * Exported because PaymentsService.payByItems also consults this
 * map to block staff cash collection during an in-flight customer
 * PayTR session.
 */
export async function fetchOrderItemReservations(
  prisma: PrismaService,
  orderIds: string[],
  tenantId: string,
  excludeIntentId?: string,
): Promise<Map<string, number>> {
  const reserved = new Map<string, number>();
  if (orderIds.length === 0) return reserved;
  const pending = await prisma.pendingSelfPayment.findMany({
    where: {
      tenantId,
      status: "PENDING",
      expiresAt: { gt: new Date() },
      ...(excludeIntentId ? { id: { not: excludeIntentId } } : {}),
    },
    select: { itemsByOrder: true },
  });
  for (const intent of pending) {
    const buckets = intent.itemsByOrder as Array<{
      orderId: string;
      items?: Array<{ orderItemId: string; quantity: number }>;
    }>;
    if (!Array.isArray(buckets)) continue;
    for (const bucket of buckets) {
      if (!orderIds.includes(bucket.orderId)) continue;
      for (const item of bucket.items || []) {
        reserved.set(
          item.orderItemId,
          (reserved.get(item.orderItemId) ?? 0) + item.quantity,
        );
      }
    }
  }
  return reserved;
}

/**
 * Owns the cross-intent reservation map + the shared mixed-payment /
 * non-allocation guard. Extracted so the read (query) and write (intent)
 * services consult one place for "which units are spoken for" and for
 * the "any non-allocation Payment hides/blocks the order" rule.
 */
@Injectable()
export class SelfPayReservationService {
  constructor(private prisma: PrismaService) {}

  /**
   * Reservations held by other in-flight PENDING PayTR intents on the
   * given orders. Thin pass-through to the exported helper so callers
   * inject this service rather than reaching for the module function.
   */
  fetchOrderItemReservations(
    orderIds: string[],
    tenantId: string,
    excludeIntentId?: string,
  ): Promise<Map<string, number>> {
    return fetchOrderItemReservations(
      this.prisma,
      orderIds,
      tenantId,
      excludeIntentId,
    );
  }

  /**
   * The "non-allocation Payment" amount on an order: COMPLETED Payment
   * total minus the sum of OrderItemPayment allocation amounts. A value
   * above the sub-kuruş tolerance (0.01) means a legacy single-payment /
   * split-bill Payment exists that can't be attributed to specific
   * items — self-pay must hide (read) or refuse (write) that order.
   */
  computeNonAllocationPaid(order: {
    payments: Array<{ amount: Prisma.Decimal | number | string }>;
    orderItems: Array<{
      orderItemPayments: Array<{ amount: Prisma.Decimal | number | string }>;
    }>;
  }): Prisma.Decimal {
    const paidAmount = order.payments.reduce<Prisma.Decimal>(
      (s, p) => s.add(new Prisma.Decimal(p.amount)),
      new Prisma.Decimal(0),
    );
    const allocationPaid = order.orderItems.reduce<Prisma.Decimal>(
      (sum, item) =>
        sum.add(
          item.orderItemPayments.reduce<Prisma.Decimal>(
            (a, p) => a.add(new Prisma.Decimal(p.amount)),
            new Prisma.Decimal(0),
          ),
        ),
      new Prisma.Decimal(0),
    );
    return paidAmount.sub(allocationPaid);
  }

  /** Sub-kuruş rounding tolerance for the residual rule. */
  static readonly NON_ALLOCATION_TOLERANCE = "0.01";

  /**
   * Write-side mixed-payment guard. Throws the same coded errors the
   * original inline loop produced (ORDER_ALREADY_PAID /
   * SELF_PAY_DISABLED_MIXED_PAYMENT). Call order preserved: paid-in-full
   * check first, then the non-allocation check.
   */
  assertOrdersSettleable(
    orders: Array<{
      id: string;
      finalAmount: Prisma.Decimal | number | string;
      payments: Array<{ amount: Prisma.Decimal | number | string }>;
      orderItems: Array<{
        orderItemPayments: Array<{ amount: Prisma.Decimal | number | string }>;
      }>;
    }>,
  ): void {
    for (const o of orders) {
      const paid = o.payments.reduce<Prisma.Decimal>(
        (s, p) => s.add(new Prisma.Decimal(p.amount)),
        new Prisma.Decimal(0),
      );
      if (paid.gte(new Prisma.Decimal(o.finalAmount))) {
        throw selfPayError(
          "ORDER_ALREADY_PAID",
          `Order ${o.id} is already fully paid — refresh the menu to update your view.`,
        );
      }
      const allocPaid = o.orderItems.reduce<Prisma.Decimal>(
        (sum, item) =>
          sum.add(
            item.orderItemPayments.reduce<Prisma.Decimal>(
              (a, p) => a.add(new Prisma.Decimal(p.amount)),
              new Prisma.Decimal(0),
            ),
          ),
        new Prisma.Decimal(0),
      );
      const nonAllocationPaid = paid.sub(allocPaid);
      if (
        nonAllocationPaid.gt(
          new Prisma.Decimal(
            SelfPayReservationService.NON_ALLOCATION_TOLERANCE,
          ),
        )
      ) {
        throw selfPayError(
          "SELF_PAY_DISABLED_MIXED_PAYMENT",
          `Order ${o.id} has a payment that wasn't recorded at item level. ` +
            "Self-pay is disabled here — please call the waiter to settle.",
        );
      }
    }
  }
}
