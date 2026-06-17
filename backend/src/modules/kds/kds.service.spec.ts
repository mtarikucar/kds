import { KdsService } from "./kds.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";

/**
 * Track-1 branch-scope hardening (Task 3).
 *
 * A kitchen display belongs to ONE branch, but the KDS REST methods
 * previously scoped by `tenantId` only — `getKitchenOrders` returned
 * EVERY branch's orders, and `updateOrderStatus` / `cancelOrder` could
 * mutate any branch's order within the tenant (cross-branch IDOR).
 *
 * These specs pin the compound (tenantId, branchId) predicate at the DB
 * boundary for the read path and the mutating claim paths.
 */
describe("KdsService branch scope", () => {
  let prisma: MockPrismaClient;
  let svc: KdsService;
  // Light jest.fn() collaborator mocks matching the real ctor arg order:
  //   (prisma, kdsGateway, deliveryStatusSync?, stockDeductionService?)
  let gateway: {
    emitOrderStatusChange: jest.Mock;
    emitOrderItemStatusChange: jest.Mock;
    emitLowStockAlert: jest.Mock;
  };

  const scope = {
    tenantId: "t-1",
    branchId: "b-1",
    userId: "u-1",
    role: "KITCHEN",
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    gateway = {
      emitOrderStatusChange: jest.fn(),
      emitOrderItemStatusChange: jest.fn(),
      emitLowStockAlert: jest.fn(),
    };
    svc = new KdsService(prisma as any, gateway as any);
  });

  it("getKitchenOrders filters by branchId AND tenantId", async () => {
    (prisma.order.findMany as any).mockResolvedValue([]);

    await svc.getKitchenOrders(scope);

    const where = (prisma.order.findMany as any).mock.calls[0][0].where;
    expect(where.branchId).toBe("b-1");
    expect(where.tenantId).toBe("t-1");
  });

  it("updateOrderStatus scopes the lookup AND the compound updateMany claim by branchId", async () => {
    (prisma.order.findFirst as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      status: "PENDING",
      requiresApproval: false,
    });
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockResolvedValue({
      id: "o-1",
      branchId: "b-1",
      orderItems: [],
    });

    await svc.updateOrderStatus(scope, "o-1", "PREPARING" as any);

    // The tenant+branch-bound lookup
    const findWhere = (prisma.order.findFirst as any).mock.calls[0][0].where;
    expect(findWhere.tenantId).toBe("t-1");
    expect(findWhere.branchId).toBe("b-1");
    // The compound TOCTOU claim must also carry the branch predicate so a
    // cross-branch order id can never be claimed.
    const claimWhere = (prisma.order.updateMany as any).mock.calls[0][0].where;
    expect(claimWhere.tenantId).toBe("t-1");
    expect(claimWhere.branchId).toBe("b-1");
  });

  it("cancelOrder scopes the lookup AND the compound cancel claim by branchId", async () => {
    (prisma.order.findFirst as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      status: "PENDING",
    });
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockResolvedValue({
      id: "o-1",
      branchId: "b-1",
      orderItems: [],
    });

    await svc.cancelOrder(scope, "o-1");

    const findWhere = (prisma.order.findFirst as any).mock.calls[0][0].where;
    expect(findWhere.tenantId).toBe("t-1");
    expect(findWhere.branchId).toBe("b-1");
    const claimWhere = (prisma.order.updateMany as any).mock.calls[0][0].where;
    expect(claimWhere.tenantId).toBe("t-1");
    expect(claimWhere.branchId).toBe("b-1");
  });

  it("updateOrderItemStatus scopes the item lookup by branch via the order relation", async () => {
    (prisma.orderItem.findFirst as any).mockResolvedValue({
      id: "i-1",
      orderId: "o-1",
      status: "PENDING",
      order: {
        id: "o-1",
        status: "PREPARING",
        requiresApproval: false,
        branchId: "b-1",
      },
    });
    (prisma.orderItem.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.orderItem.findUniqueOrThrow as any).mockResolvedValue({
      id: "i-1",
      order: { id: "o-1", branchId: "b-1" },
    });
    (prisma.orderItem.findMany as any).mockResolvedValue([
      { status: "PREPARING" },
    ]);

    await svc.updateOrderItemStatus(scope, "i-1", "PREPARING" as any);

    const findWhere = (prisma.orderItem.findFirst as any).mock.calls[0][0]
      .where;
    // Relation filter must spread the full branch scope, not just tenantId.
    expect(findWhere.order.tenantId).toBe("t-1");
    expect(findWhere.order.branchId).toBe("b-1");
  });
});

/**
 * deep-review H11/M17 — bumping the LAST item to READY on a still-PENDING
 * ticket must auto-promote the order to READY by bridging the intermediate
 * PREPARING hop (the state machine forbids PENDING→READY), WITHOUT throwing
 * a 400 after the item write already committed, and the item-status WS emit
 * must still fire.
 */
describe("KdsService item-bump auto-promotion (H11/M17)", () => {
  let prisma: MockPrismaClient;
  let gateway: {
    emitOrderStatusChange: jest.Mock;
    emitOrderItemStatusChange: jest.Mock;
    emitLowStockAlert: jest.Mock;
  };
  let svc: KdsService;

  const scope = {
    tenantId: "t-1",
    branchId: "b-1",
    userId: "u-1",
    role: "KITCHEN",
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    gateway = {
      emitOrderStatusChange: jest.fn(),
      emitOrderItemStatusChange: jest.fn(),
      emitLowStockAlert: jest.fn(),
    };
    svc = new KdsService(prisma as any, gateway as any);
  });

  it("PENDING order, last item bumped READY → order ends READY via PREPARING, item READY, no throw, WS emit fires", async () => {
    // The item being bumped, on a PENDING order.
    (prisma.orderItem.findFirst as any).mockResolvedValue({
      id: "i-1",
      orderId: "o-1",
      status: "PREPARING",
      order: {
        id: "o-1",
        status: "PENDING",
        requiresApproval: false,
        branchId: "b-1",
      },
    });
    (prisma.orderItem.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.orderItem.findUniqueOrThrow as any).mockResolvedValue({
      id: "i-1",
      status: "READY",
      order: { id: "o-1", branchId: "b-1" },
    });
    // Every item is now READY → promotion should run.
    (prisma.orderItem.findMany as any).mockResolvedValue([{ status: "READY" }]);

    // The recursive updateOrderStatus reads the order via findFirst. First
    // call sees PENDING (→ PREPARING hop), second call sees PREPARING (→ READY).
    (prisma.order.findFirst as any)
      .mockResolvedValueOnce({
        id: "o-1",
        tenantId: "t-1",
        branchId: "b-1",
        status: "PENDING",
        requiresApproval: false,
      })
      .mockResolvedValueOnce({
        id: "o-1",
        tenantId: "t-1",
        branchId: "b-1",
        status: "PREPARING",
        requiresApproval: false,
      });
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      status: "READY",
      finalAmount: null,
      orderItems: [],
    });
    // The "fresh" re-read between the PREPARING hop and the READY promotion
    // must report PREPARING so canTransition(PREPARING, READY) is true.
    (prisma.order.findUnique as any).mockResolvedValue({ status: "PREPARING" });

    await expect(
      svc.updateOrderItemStatus(scope, "i-1", "READY" as any),
    ).resolves.toBeDefined();

    // Two order-status writes: PENDING→PREPARING, then PREPARING→READY.
    const statuses = (prisma.order.updateMany as any).mock.calls.map(
      (c: any) => c[0].data.status,
    );
    expect(statuses).toEqual(["PREPARING", "READY"]);
    // Item-status WS emit must still fire (it did not, in the old throwing path).
    expect(gateway.emitOrderItemStatusChange).toHaveBeenCalledWith(
      "t-1",
      "b-1",
      "i-1",
      "READY",
    );
  });

  it("PENDING_APPROVAL order with all items READY does not auto-promote and does not throw", async () => {
    (prisma.orderItem.findFirst as any).mockResolvedValue({
      id: "i-1",
      orderId: "o-1",
      status: "PREPARING",
      order: {
        id: "o-1",
        status: "PENDING_APPROVAL",
        requiresApproval: true,
        branchId: "b-1",
      },
    });
    (prisma.orderItem.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.orderItem.findUniqueOrThrow as any).mockResolvedValue({
      id: "i-1",
      status: "READY",
      order: { id: "o-1", branchId: "b-1" },
    });
    (prisma.orderItem.findMany as any).mockResolvedValue([{ status: "READY" }]);

    await expect(
      svc.updateOrderItemStatus(scope, "i-1", "READY" as any),
    ).resolves.toBeDefined();

    // No order-status write may happen for a PENDING_APPROVAL ticket.
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(gateway.emitOrderItemStatusChange).toHaveBeenCalled();
  });
});

/**
 * Track 2 observability — every committed KDS status write bumps a
 * Prometheus counter labeled by the developer-controlled status enum, so a
 * Grafana panel can show ticket/item throughput per status and alert on
 * anomalies (e.g. tickets stuck never reaching READY).
 *
 * Mirrors the merged stock_movements_total pattern: @Optional() MetricsService
 * injected last in the ctor, increment AFTER the committed DB write, and
 * ?.-guarded so a missing collaborator can never break the business write.
 */
describe("KdsService metrics", () => {
  let prisma: MockPrismaClient;
  let gateway: {
    emitOrderStatusChange: jest.Mock;
    emitOrderItemStatusChange: jest.Mock;
    emitLowStockAlert: jest.Mock;
  };
  let metrics: { incCounter: jest.Mock };
  let svc: KdsService;

  const scope = {
    tenantId: "t-1",
    branchId: "b-1",
    userId: "u-1",
    role: "KITCHEN",
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    gateway = {
      emitOrderStatusChange: jest.fn(),
      emitOrderItemStatusChange: jest.fn(),
      emitLowStockAlert: jest.fn(),
    };
    metrics = { incCounter: jest.fn() };
    // ctor arg order: (prisma, kdsGateway, deliveryStatusSync?,
    // stockDeductionService?, metrics?)
    svc = new KdsService(
      prisma as any,
      gateway as any,
      undefined,
      undefined,
      metrics as any,
    );
  });

  it("updateOrderStatus records kds_ticket_status_total labeled by status", async () => {
    (prisma.order.findFirst as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      status: "PENDING",
      requiresApproval: false,
    });
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockResolvedValue({
      id: "o-1",
      branchId: "b-1",
      orderItems: [],
    });

    await svc.updateOrderStatus(scope, "o-1", "PREPARING" as any);

    expect(metrics.incCounter).toHaveBeenCalledWith(
      "kds_ticket_status_total",
      expect.any(String),
      { status: "PREPARING" },
    );
  });

  it("updateOrderItemStatus records kds_ticket_item_status_total labeled by status", async () => {
    (prisma.orderItem.findFirst as any).mockResolvedValue({
      id: "i-1",
      orderId: "o-1",
      status: "PENDING",
      order: {
        id: "o-1",
        status: "PREPARING",
        requiresApproval: false,
        branchId: "b-1",
      },
    });
    (prisma.orderItem.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.orderItem.findUniqueOrThrow as any).mockResolvedValue({
      id: "i-1",
      order: { id: "o-1", branchId: "b-1" },
    });
    // Not all items READY → updateOrderStatus is NOT recursively triggered,
    // so the only emit is the item-status one.
    (prisma.orderItem.findMany as any).mockResolvedValue([
      { status: "PREPARING" },
    ]);

    await svc.updateOrderItemStatus(scope, "i-1", "PREPARING" as any);

    expect(metrics.incCounter).toHaveBeenCalledWith(
      "kds_ticket_item_status_total",
      expect.any(String),
      { status: "PREPARING" },
    );
  });

  it("does not throw when no MetricsService is injected (optional dep)", async () => {
    const bare = new KdsService(prisma as any, gateway as any);
    (prisma.order.findFirst as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      status: "PENDING",
      requiresApproval: false,
    });
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockResolvedValue({
      id: "o-1",
      branchId: "b-1",
      orderItems: [],
    });

    await expect(
      bare.updateOrderStatus(scope, "o-1", "PREPARING" as any),
    ).resolves.toBeDefined();
  });
});

/**
 * Track 3 — durable outbox events for KDS-originated status transitions.
 *
 * KdsService writes order status directly and broadcasts an EPHEMERAL
 * kdsGateway WebSocket signal — but a crash right after the status commit
 * loses that signal, so outbox consumers (kds-routing physical-device
 * fan-out, marketing relay) never see KDS-originated transitions. These
 * specs pin that, AFTER the committed write, KdsService also appends a
 * durable order.updated/completed/cancelled.v1 with the OrdersService
 * payload shape (orderId/tenantId/branchId/tableId/status/totalCents via
 * the integer-cents convention) — AND that the live WS broadcast still
 * fires alongside it (the durable emit augments, never replaces, the UI
 * signal).
 */
describe("KdsService durable outbox events", () => {
  let prisma: MockPrismaClient;
  let gateway: {
    emitOrderStatusChange: jest.Mock;
    emitOrderItemStatusChange: jest.Mock;
    emitLowStockAlert: jest.Mock;
  };
  let outbox: { append: jest.Mock };
  let svc: KdsService;

  const scope = {
    tenantId: "t-1",
    branchId: "b-1",
    userId: "u-1",
    role: "KITCHEN",
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    gateway = {
      emitOrderStatusChange: jest.fn(),
      emitOrderItemStatusChange: jest.fn(),
      emitLowStockAlert: jest.fn(),
    };
    outbox = { append: jest.fn().mockResolvedValue("outbox-id") };
    // ctor arg order: (prisma, kdsGateway, deliveryStatusSync?,
    // stockDeductionService?, metrics?, outbox?)
    svc = new KdsService(
      prisma as any,
      gateway as any,
      undefined,
      undefined,
      undefined,
      outbox as any,
    );
  });

  it("updateOrderStatus → READY appends a durable order.updated.v1 AND still WS-broadcasts", async () => {
    (prisma.order.findFirst as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      status: "PREPARING",
      requiresApproval: false,
    });
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      tableId: "tbl-9",
      status: "READY",
      // Prisma.Decimal-like: exposes toFixed (non-number) so toIntCents
      // routes through the string path, never the IEEE-754 float boundary.
      finalAmount: { toFixed: (n: number) => (123.45).toFixed(n) },
      orderItems: [],
    });

    await svc.updateOrderStatus(scope, "o-1", "READY" as any);

    // Live WS broadcast must STILL fire alongside the durable emit.
    expect(gateway.emitOrderStatusChange).toHaveBeenCalledWith(
      "t-1",
      "b-1",
      "o-1",
      "READY",
    );
    // Durable append: matching OrdersService event payload shape +
    // integer-cents money convention.
    expect(outbox.append).toHaveBeenCalledWith({
      type: "order.updated.v1",
      tenantId: "t-1",
      payload: {
        orderId: "o-1",
        tenantId: "t-1",
        branchId: "b-1",
        tableId: "tbl-9",
        status: "READY",
        totalCents: 12345,
      },
    });
  });

  it("updateOrderStatus → SERVED appends order.completed.v1", async () => {
    (prisma.order.findFirst as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      status: "READY",
      requiresApproval: false,
    });
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      tableId: null,
      status: "SERVED",
      finalAmount: null,
      orderItems: [],
    });

    await svc.updateOrderStatus(scope, "o-1", "SERVED" as any);

    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "order.completed.v1",
        tenantId: "t-1",
        payload: expect.objectContaining({
          orderId: "o-1",
          status: "SERVED",
          tableId: null,
          // null finalAmount → totalCents undefined (mirrors OrdersService).
          totalCents: undefined,
        }),
      }),
    );
  });

  it("cancelOrder appends a durable order.cancelled.v1 AND still WS-broadcasts", async () => {
    (prisma.order.findFirst as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      status: "PENDING",
    });
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      tableId: "tbl-3",
      status: "CANCELLED",
      finalAmount: "50.00",
      orderItems: [],
    });

    await svc.cancelOrder(scope, "o-1");

    expect(gateway.emitOrderStatusChange).toHaveBeenCalledWith(
      "t-1",
      "b-1",
      "o-1",
      "CANCELLED",
    );
    expect(outbox.append).toHaveBeenCalledWith({
      type: "order.cancelled.v1",
      tenantId: "t-1",
      payload: {
        orderId: "o-1",
        tenantId: "t-1",
        branchId: "b-1",
        tableId: "tbl-3",
        status: "CANCELLED",
        // string finalAmount → integer cents.
        totalCents: 5000,
      },
    });
  });

  it("does not throw and still WS-broadcasts when no OutboxService is injected (optional dep)", async () => {
    const bare = new KdsService(prisma as any, gateway as any);
    (prisma.order.findFirst as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      status: "PENDING",
      requiresApproval: false,
    });
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      status: "PREPARING",
      orderItems: [],
    });

    await expect(
      bare.updateOrderStatus(scope, "o-1", "PREPARING" as any),
    ).resolves.toBeDefined();
    // The durable emit no-ops without an outbox, but the live WS broadcast
    // must still fire so the KDS UI keeps updating.
    expect(gateway.emitOrderStatusChange).toHaveBeenCalled();
  });

  it("swallows an outbox append rejection without breaking the status write", async () => {
    outbox.append.mockRejectedValueOnce(new Error("outbox down"));
    (prisma.order.findFirst as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      status: "PREPARING",
      requiresApproval: false,
    });
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockResolvedValue({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      status: "READY",
      finalAmount: null,
      orderItems: [],
    });

    await expect(
      svc.updateOrderStatus(scope, "o-1", "READY" as any),
    ).resolves.toBeDefined();
    expect(outbox.append).toHaveBeenCalled();
  });
});
