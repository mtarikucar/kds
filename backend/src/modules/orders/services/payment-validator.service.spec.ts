import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PaymentValidator } from "./payment-validator.service";
import {
  OrderStatus,
  PaymentStatus,
} from "../../../common/constants/order-status.enum";

/**
 * Unit tests for the pure validation seams lifted out of PaymentsService
 * (PASS 3). They pin the byte-identical exception types/messages/ordering
 * the inline create/splitBill/payByItems code threw, plus the small
 * returned values the orchestrators reuse downstream.
 */
describe("PaymentValidator", () => {
  let v: PaymentValidator;

  beforeEach(() => {
    v = new PaymentValidator();
  });

  describe("assertOrderPayable", () => {
    it("passes for a SERVED, non-approval order", () => {
      expect(() =>
        v.assertOrderPayable({
          status: OrderStatus.SERVED,
          requiresApproval: false,
        }),
      ).not.toThrow();
    });

    it("rejects a PAID order with the exact message", () => {
      expect(() =>
        v.assertOrderPayable({
          status: OrderStatus.PAID,
          requiresApproval: false,
        }),
      ).toThrow("Order is already paid");
    });

    it("rejects a CANCELLED order with the exact message", () => {
      expect(() =>
        v.assertOrderPayable({
          status: OrderStatus.CANCELLED,
          requiresApproval: false,
        }),
      ).toThrow("Cannot pay for a cancelled order");
    });

    it("rejects requiresApproval + PENDING_APPROVAL", () => {
      expect(() =>
        v.assertOrderPayable({
          status: OrderStatus.PENDING_APPROVAL,
          requiresApproval: true,
        }),
      ).toThrow("Order requires approval before payment");
    });

    it("does NOT block PENDING_APPROVAL when requiresApproval is false", () => {
      expect(() =>
        v.assertOrderPayable({
          status: OrderStatus.PENDING_APPROVAL,
          requiresApproval: false,
        }),
      ).not.toThrow();
    });

    it("throws BadRequestException (type) for a non-payable order", () => {
      expect(() =>
        v.assertOrderPayable({
          status: OrderStatus.PAID,
          requiresApproval: false,
        }),
      ).toThrow(BadRequestException);
    });

    it("evaluates PAID before the approval guard", () => {
      // A PAID + requiresApproval order surfaces the PAID message first
      // (same order the inline code ran the checks).
      expect(() =>
        v.assertOrderPayable({
          status: OrderStatus.PAID,
          requiresApproval: true,
        }),
      ).toThrow("Order is already paid");
    });
  });

  describe("validateSplitTotal", () => {
    const order = (finalAmount: string, paid: string[] = []) => ({
      finalAmount: new Prisma.Decimal(finalAmount),
      payments: paid.map((a) => ({ amount: new Prisma.Decimal(a) })),
    });

    it("returns orderAmount and remaining for an exact-match split", () => {
      const { orderAmount, remaining } = v.validateSplitTotal(
        order("100.00"),
        { payments: [{ amount: 60 }, { amount: 40 }] },
      );
      expect(orderAmount.toFixed(2)).toBe("100.00");
      expect(remaining.toFixed(2)).toBe("100.00");
    });

    it("subtracts already-completed payments from remaining", () => {
      const { remaining } = v.validateSplitTotal(order("100.00", ["30.00"]), {
        payments: [{ amount: 70 }],
      });
      expect(remaining.toFixed(2)).toBe("70.00");
    });

    it("rejects a total that EXCEEDS remaining beyond tolerance", () => {
      expect(() =>
        v.validateSplitTotal(order("100.00"), {
          payments: [{ amount: 60 }, { amount: 41 }],
        }),
      ).toThrow("Split total (101.00) exceeds remaining amount (100.00)");
    });

    it("rejects a total that is BELOW remaining beyond tolerance", () => {
      expect(() =>
        v.validateSplitTotal(order("100.00"), {
          payments: [{ amount: 50 }, { amount: 49 }],
        }),
      ).toThrow("Split total (99.00) is below remaining amount (100.00)");
    });

    it("accepts the +0.01 tolerance edge", () => {
      expect(() =>
        v.validateSplitTotal(order("100.00"), {
          payments: [{ amount: 50 }, { amount: 50.01 }],
        }),
      ).not.toThrow();
    });

    it("accepts the -0.01 tolerance edge", () => {
      expect(() =>
        v.validateSplitTotal(order("100.00"), {
          payments: [{ amount: 50 }, { amount: 49.99 }],
        }),
      ).not.toThrow();
    });

    it("stays Decimal-clean across many sub-kuruş lines (no drift)", () => {
      // 20 lines of 5.00 == 100.00 exactly.
      const payments = Array.from({ length: 20 }, () => ({ amount: 5.0 }));
      expect(() =>
        v.validateSplitTotal(order("100.00"), { payments }),
      ).not.toThrow();
    });
  });

  describe("resolveItemsById", () => {
    const items = [
      { id: "i1", quantity: 2 },
      { id: "i2", quantity: 1 },
    ];

    it("returns an id→item map for valid entries", () => {
      const map = v.resolveItemsById(items, [
        { orderItemId: "i1" },
        { orderItemId: "i2" },
      ]);
      expect(map.get("i1")).toEqual({ id: "i1", quantity: 2 });
      expect(map.get("i2")).toEqual({ id: "i2", quantity: 1 });
    });

    it("rejects an entry that does not belong to the order", () => {
      expect(() =>
        v.resolveItemsById(items, [{ orderItemId: "ghost" }]),
      ).toThrow("OrderItem ghost does not belong to this order");
    });

    it("rejects a duplicate orderItemId in the same request", () => {
      expect(() =>
        v.resolveItemsById(items, [
          { orderItemId: "i1" },
          { orderItemId: "i1" },
        ]),
      ).toThrow("Duplicate orderItemId i1 in items list");
    });

    it("checks membership BEFORE the duplicate guard", () => {
      // A ghost id surfaces the membership error even if it's duplicated.
      expect(() =>
        v.resolveItemsById(items, [
          { orderItemId: "ghost" },
          { orderItemId: "ghost" },
        ]),
      ).toThrow("does not belong to this order");
    });

    it("exposes the shared ±0.01 tolerance constant", () => {
      expect(PaymentValidator.PAYMENT_TOLERANCE.toFixed(2)).toBe("0.01");
      // Sanity: keep PaymentStatus import meaningful for parity with the
      // service's enum surface (no behavioural assertion).
      expect(PaymentStatus.COMPLETED).toBeDefined();
    });
  });
});
