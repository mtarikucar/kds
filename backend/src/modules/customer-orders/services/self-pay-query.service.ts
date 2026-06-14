import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { forwardRef, Inject } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { PaymentsService } from "../../orders/services/payments.service";
import { CustomerSessionService } from "../../customers/customer-session.service";
import {
  OrderStatus,
  PaymentStatus,
} from "../../../common/constants/order-status.enum";
import { SelfPayReservationService } from "./self-pay-reservation.service";

/**
 * Read side of customer self-pay: the table-wide payable-items view and
 * the post-redirect status poll (which also returns the remaining
 * summary). Extracted from CustomerSelfPayService verbatim — every
 * scope filter, mixed-payment hide, reservation subtraction and lazy
 * EXPIRED flip is byte-for-byte the original.
 */
@Injectable()
export class SelfPayQueryService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => PaymentsService))
    private paymentsService: PaymentsService,
    private customerSessionService: CustomerSessionService,
    private reservations: SelfPayReservationService,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  // READ: table-wide payable items for the session's table
  // ──────────────────────────────────────────────────────────────────

  async getPayableItemsForSession(sessionId: string) {
    const session = await this.customerSessionService.requireSession(sessionId);

    // Surface the toggle in the read response too so the QR menu
    // can hide the "Pay Now" button on tenants that haven't opted
    // in. The createPayIntent path will also enforce it server-side
    // — this is a UX-layer convenience.
    // v3.0.1 — findFirst (compound-unique with branchId: null trips
    // Prisma client validation; see branch-scope helper note).
    const posSettings = await this.prisma.posSettings.findFirst({
      where: { tenantId: session.tenantId, branchId: null },
      select: { enableCustomerSelfPay: true },
    });
    const selfPayEnabled = !!posSettings?.enableCustomerSelfPay;

    // Two query modes:
    //  - Dine-in (session.tableId set): return everyone's open orders
    //    on that table, so any diner can pay any item (full self-service
    //    matches the in-restaurant social model — splitting, treating,
    //    "I'll get this one"). The waiter still owns the table.
    //  - Takeaway / QR-counter (no tableId): return only the orders
    //    this session created. A takeaway customer paying from their
    //    phone shouldn't see (or be able to pay for) some other
    //    customer's pickup order.
    const orderWhere = session.tableId
      ? {
          tableId: session.tableId,
          tenantId: session.tenantId,
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        }
      : {
          sessionId,
          tenantId: session.tenantId,
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        };

    const orders = await this.prisma.order.findMany({
      where: orderWhere,
      include: {
        orderItems: {
          include: {
            product: true,
            modifiers: { include: { modifier: true } },
            orderItemPayments: {
              where: { payment: { status: PaymentStatus.COMPLETED } },
            },
          },
        },
        payments: {
          where: { status: PaymentStatus.COMPLETED },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Reservations from other customers' PENDING PayTR intents.
    // We treat reserved-but-not-yet-paid units as unavailable so two
    // phones can't both check out the same burger.
    const reservations = await this.reservations.fetchOrderItemReservations(
      orders.map((o) => o.id),
      session.tenantId,
    );

    let grandTotal = new Prisma.Decimal(0);
    let grandPaid = new Prisma.Decimal(0);
    let grandRemainingQty = 0;

    // Filter orders so the customer never sees an order where any
    // non-allocation Payment exists — the legacy single-payment /
    // split-bill paths book Payment rows without OrderItemPayment
    // allocations, so a per-item paidQuantity check alone can't tell
    // which items those rows "covered". Mixing self-pay on top of
    // such an order would either under- or over-count remaining
    // (both directions yield double-charges or stranded items).
    //
    // The safe semantic: if ANY non-allocation Payment exists on the
    // order, hide the whole order from the customer's self-pay view.
    // They can still call the waiter to settle. Once the restaurant
    // standardizes on payByItems for the table, this branch goes
    // dormant naturally.
    const filteredOrders = orders.filter((o) => {
      const finalAmount = new Prisma.Decimal(o.finalAmount);
      const paidAmount = o.payments.reduce<Prisma.Decimal>(
        (s, p) => s.add(new Prisma.Decimal(p.amount)),
        new Prisma.Decimal(0),
      );
      if (paidAmount.gte(finalAmount)) return false;
      const allocationPaid = o.orderItems.reduce<Prisma.Decimal>(
        (sum, item) =>
          sum.add(
            item.orderItemPayments.reduce<Prisma.Decimal>(
              (a, p) => a.add(new Prisma.Decimal(p.amount)),
              new Prisma.Decimal(0),
            ),
          ),
        new Prisma.Decimal(0),
      );
      // Tolerance for sub-kuruş rounding from the residual rule.
      const nonAllocationPaid = paidAmount.sub(allocationPaid);
      if (nonAllocationPaid.gt(new Prisma.Decimal("0.01"))) return false;
      return true;
    });

    const orderViews = filteredOrders.map((o) => {
      const finalAmount = new Prisma.Decimal(o.finalAmount);
      const paidAmount = o.payments.reduce<Prisma.Decimal>(
        (s, p) => s.add(new Prisma.Decimal(p.amount)),
        new Prisma.Decimal(0),
      );
      grandTotal = grandTotal.add(finalAmount);
      grandPaid = grandPaid.add(paidAmount);

      const items = o.orderItems.map((item) => {
        const paidQuantity = item.orderItemPayments.reduce(
          (s, a) => s + a.quantity,
          0,
        );
        const reservedQuantity = reservations.get(item.id) ?? 0;
        // No legacyShare here — orders with non-allocation Payments
        // were filtered out above, so the per-item count is fully
        // backed by OrderItemPayment rows.
        const remainingQuantity = Math.max(
          0,
          item.quantity - paidQuantity - reservedQuantity,
        );
        grandRemainingQty += remainingQuantity;
        const perUnit = this.paymentsService.derivePerUnitNet(item, o);
        const itemTotal = perUnit.mul(item.quantity);
        return {
          orderItemId: item.id,
          productName: item.product?.name ?? null,
          quantity: item.quantity,
          paidQuantity,
          reservedQuantity,
          remainingQuantity,
          unitTotal: perUnit.toFixed(2),
          itemTotal: itemTotal.toFixed(2),
          modifierLabels: (item.modifiers || [])
            .map((m) => m.modifier?.displayName || m.modifier?.name || "")
            .filter(Boolean),
        };
      });

      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        finalAmount: finalAmount.toFixed(2),
        paidAmount: paidAmount.toFixed(2),
        remainingAmount: finalAmount.sub(paidAmount).toFixed(2),
        items,
      };
    });

    return {
      sessionId,
      tableId: session.tableId,
      selfPayEnabled,
      orders: orderViews,
      summary: {
        totalAmount: grandTotal.toFixed(2),
        paidAmount: grandPaid.toFixed(2),
        remainingAmount: grandTotal.sub(grandPaid).toFixed(2),
        remainingQuantity: grandRemainingQty,
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // READ: poll for status after PayTR redirect
  // ──────────────────────────────────────────────────────────────────

  /**
   * Poll endpoint after PayTR redirects the customer back. Intentionally
   * does NOT require an active CustomerSession — that record expires
   * after 4 hours, and a customer returning from a flaky network or a
   * long 3DS detour shouldn't be locked out of their own receipt.
   *
   * The merchantOid is an unguessable 27+ character token issued by
   * us inside createPayIntent, so its possession is sufficient
   * authentication for a read-only status view. We still cross-check
   * sessionId to keep the route URL-scoped (a customer in tenant A
   * can't probe tenant B's intent ids).
   *
   * Lazy expire: if expiresAt has passed and the row is still
   * PENDING, flip it to EXPIRED on the fly so the client sees a
   * terminal status instead of polling forever.
   */
  async getPayStatus(sessionId: string, merchantOid: string) {
    const intent = await this.prisma.pendingSelfPayment.findUnique({
      where: { merchantOid },
    });
    if (!intent || intent.sessionId !== sessionId) {
      throw new NotFoundException("Payment intent not found for this session");
    }

    let status = intent.status;
    let failureReason = intent.failureReason;
    if (status === "PENDING" && intent.expiresAt < new Date()) {
      const updated = await this.prisma.pendingSelfPayment.updateMany({
        where: { id: intent.id, status: "PENDING" },
        data: { status: "EXPIRED", failureReason: "expired" },
      });
      if (updated.count > 0) {
        status = "EXPIRED";
        failureReason = "expired";
      }
    }

    // remaining summary needs an active session; if the session has
    // expired by the time the customer returns, we still return the
    // payment outcome (the important bit) and just leave `remaining`
    // null. The receipt UI handles a null remaining gracefully.
    let remaining: Awaited<
      ReturnType<typeof this.getPayableItemsForSession>
    > | null = null;
    try {
      remaining = await this.getPayableItemsForSession(sessionId);
    } catch {
      remaining = null;
    }

    return {
      merchantOid,
      status,
      amount: intent.amount.toFixed(2),
      failureReason,
      remaining,
    };
  }
}
