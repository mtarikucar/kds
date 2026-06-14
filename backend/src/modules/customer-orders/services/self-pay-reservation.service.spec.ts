import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  SelfPayReservationService,
  fetchOrderItemReservations,
} from "./self-pay-reservation.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * Real-logic spec for SelfPayReservationService — the cross-intent
 * reservation map + the shared mixed-payment / non-allocation money guard.
 *
 * These pure methods are NOT exercised directly by the facade
 * characterization spec, yet they encode load-bearing money rules:
 *  - computeNonAllocationPaid: paidTotal − allocationPaid (the residual
 *    that, above 0.01, means a legacy non-item-level Payment exists).
 *  - assertOrdersSettleable: paid-in-full check FIRST, then the
 *    non-allocation residual check; both throw coded BadRequests; the
 *    0.01 tolerance edge.
 *  - fetchOrderItemReservations: PENDING+unexpired intent query, the
 *    excludeIntentId filter, orderId scoping, and per-orderItem quantity
 *    summation across multiple intents.
 */
describe("SelfPayReservationService", () => {
  const TENANT = "tenant-1";
  let prisma: MockPrismaClient;
  let svc: SelfPayReservationService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new SelfPayReservationService(prisma as any);
  });

  const D = (v: string | number) => new Prisma.Decimal(v);

  describe("computeNonAllocationPaid", () => {
    it("returns paid − allocated when a legacy non-allocation Payment exists", () => {
      const res = svc.computeNonAllocationPaid({
        payments: [{ amount: 100 }, { amount: 20 }], // 120 total
        orderItems: [
          { orderItemPayments: [{ amount: 50 }] },
          { orderItemPayments: [{ amount: 30 }, { amount: 10 }] },
        ], // 90 allocated
      });
      expect(res.toString()).toBe("30");
    });

    it("returns 0 when every payment is allocated to items", () => {
      const res = svc.computeNonAllocationPaid({
        payments: [{ amount: "40.00" }],
        orderItems: [{ orderItemPayments: [{ amount: "40.00" }] }],
      });
      expect(res.equals(D(0))).toBe(true);
    });

    it("handles Decimal inputs without float drift", () => {
      const res = svc.computeNonAllocationPaid({
        payments: [{ amount: D("10.10") }, { amount: D("0.20") }],
        orderItems: [{ orderItemPayments: [{ amount: D("10.30") }] }],
      });
      expect(res.toString()).toBe("0");
    });
  });

  describe("assertOrdersSettleable", () => {
    const settleable = {
      id: "order-1",
      finalAmount: 100,
      payments: [{ amount: 0 }],
      orderItems: [{ orderItemPayments: [] as any[] }],
    };

    it("passes through when nothing is paid", () => {
      expect(() => svc.assertOrdersSettleable([settleable])).not.toThrow();
    });

    it("throws ORDER_ALREADY_PAID when payments cover finalAmount", () => {
      try {
        svc.assertOrdersSettleable([
          {
            id: "order-1",
            finalAmount: 100,
            payments: [{ amount: 100 }],
            orderItems: [{ orderItemPayments: [{ amount: 100 }] }],
          },
        ]);
        fail("expected throw");
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.getResponse().code).toBe("ORDER_ALREADY_PAID");
      }
    });

    it("paid-in-full takes priority over the non-allocation check", () => {
      // paid == final AND there is a non-allocation residual; the
      // already-paid branch must win (it's evaluated first).
      try {
        svc.assertOrdersSettleable([
          {
            id: "order-1",
            finalAmount: 50,
            payments: [{ amount: 50 }],
            orderItems: [{ orderItemPayments: [] }], // residual 50 too
          },
        ]);
        fail("expected throw");
      } catch (e: any) {
        expect(e.getResponse().code).toBe("ORDER_ALREADY_PAID");
      }
    });

    it("throws SELF_PAY_DISABLED_MIXED_PAYMENT when a non-allocation residual > 0.01 and order not fully paid", () => {
      try {
        svc.assertOrdersSettleable([
          {
            id: "order-9",
            finalAmount: 100,
            payments: [{ amount: 30 }], // partial
            orderItems: [{ orderItemPayments: [] }], // residual 30
          },
        ]);
        fail("expected throw");
      } catch (e: any) {
        expect(e.getResponse().code).toBe("SELF_PAY_DISABLED_MIXED_PAYMENT");
        expect(e.getResponse().message).toContain("order-9");
      }
    });

    it("allows a residual at exactly the 0.01 tolerance (not > tolerance)", () => {
      expect(() =>
        svc.assertOrdersSettleable([
          {
            id: "order-1",
            finalAmount: 100,
            payments: [{ amount: "0.01" }],
            orderItems: [{ orderItemPayments: [] }],
          },
        ]),
      ).not.toThrow();
    });

    it("validates every order in the list (second order trips the guard)", () => {
      try {
        svc.assertOrdersSettleable([
          settleable,
          {
            id: "order-2",
            finalAmount: 100,
            payments: [{ amount: 100 }],
            orderItems: [{ orderItemPayments: [{ amount: 100 }] }],
          },
        ]);
        fail("expected throw");
      } catch (e: any) {
        expect(e.getResponse().message).toContain("order-2");
      }
    });
  });

  describe("fetchOrderItemReservations", () => {
    it("returns an empty map immediately when no orderIds are given (no DB hit)", async () => {
      const res = await svc.fetchOrderItemReservations([], TENANT);
      expect(res.size).toBe(0);
      expect(prisma.pendingSelfPayment.findMany).not.toHaveBeenCalled();
    });

    it("queries PENDING + unexpired intents scoped to tenant", async () => {
      (prisma.pendingSelfPayment.findMany as any).mockResolvedValue([]);

      const before = Date.now();
      await svc.fetchOrderItemReservations(["order-1"], TENANT);

      const arg = (prisma.pendingSelfPayment.findMany as any).mock.calls[0][0];
      expect(arg.where.tenantId).toBe(TENANT);
      expect(arg.where.status).toBe("PENDING");
      expect(arg.where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(before);
      // No exclude filter by default.
      expect(arg.where.id).toBeUndefined();
    });

    it("adds the excludeIntentId filter when provided", async () => {
      (prisma.pendingSelfPayment.findMany as any).mockResolvedValue([]);

      await svc.fetchOrderItemReservations(["order-1"], TENANT, "intent-x");

      const arg = (prisma.pendingSelfPayment.findMany as any).mock.calls[0][0];
      expect(arg.where.id).toEqual({ not: "intent-x" });
    });

    it("sums reserved quantities per orderItem across multiple intents, scoped to the requested orders", async () => {
      (prisma.pendingSelfPayment.findMany as any).mockResolvedValue([
        {
          itemsByOrder: [
            {
              orderId: "order-1",
              items: [
                { orderItemId: "oi-1", quantity: 2 },
                { orderItemId: "oi-2", quantity: 1 },
              ],
            },
            {
              // not in the requested orderIds → ignored
              orderId: "order-OTHER",
              items: [{ orderItemId: "oi-9", quantity: 99 }],
            },
          ],
        },
        {
          itemsByOrder: [
            {
              orderId: "order-1",
              items: [{ orderItemId: "oi-1", quantity: 3 }],
            },
          ],
        },
      ]);

      const res = await svc.fetchOrderItemReservations(["order-1"], TENANT);

      // oi-1 reserved across two intents: 2 + 3 = 5
      expect(res.get("oi-1")).toBe(5);
      expect(res.get("oi-2")).toBe(1);
      // The other-order item must NOT leak in.
      expect(res.has("oi-9")).toBe(false);
    });

    it("tolerates a malformed itemsByOrder (non-array) by skipping it", async () => {
      (prisma.pendingSelfPayment.findMany as any).mockResolvedValue([
        { itemsByOrder: { not: "an array" } },
        {
          itemsByOrder: [
            { orderId: "order-1", items: [{ orderItemId: "oi-1", quantity: 4 }] },
          ],
        },
      ]);

      const res = await svc.fetchOrderItemReservations(["order-1"], TENANT);
      expect(res.get("oi-1")).toBe(4);
      expect(res.size).toBe(1);
    });

    it("treats a bucket with no items array as zero contributions", async () => {
      (prisma.pendingSelfPayment.findMany as any).mockResolvedValue([
        { itemsByOrder: [{ orderId: "order-1" }] }, // no `items`
      ]);

      const res = await svc.fetchOrderItemReservations(["order-1"], TENANT);
      expect(res.size).toBe(0);
    });
  });

  describe("exported fetchOrderItemReservations helper", () => {
    it("matches the service method behaviour (module function parity)", async () => {
      (prisma.pendingSelfPayment.findMany as any).mockResolvedValue([
        {
          itemsByOrder: [
            { orderId: "order-1", items: [{ orderItemId: "oi-1", quantity: 7 }] },
          ],
        },
      ]);

      const res = await fetchOrderItemReservations(
        prisma as any,
        ["order-1"],
        TENANT,
      );
      expect(res.get("oi-1")).toBe(7);
    });
  });
});
