import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DeliveryModerationService } from "./delivery-moderation.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";
import { OrderStatus } from "../../../common/constants/order-status.enum";
import { PlatformLogAction } from "../constants/platform.enum";

/**
 * Behaviour locks for operator ACCEPT / REJECT / set PREP-TIME:
 *
 *  - Resolution is tenant-scoped and platform-only: an order belonging to
 *    another tenant 404s; an internal/POS order (no source) 400s — never
 *    moderated through here.
 *  - Honesty: if the adapter throws, the internal status is NEVER advanced,
 *    the failure is logged (success:false) and the circuit-breaker is bumped,
 *    and the error propagates to the caller (no fabricated success).
 *  - Reject MUST carry the reason to the platform AND record it.
 *  - Idempotency: re-accepting an accepted order / re-rejecting a cancelled
 *    one is a no-op that does NOT re-hit the platform.
 *  - The right adapter method fires: accept->acceptOrder, reject->rejectOrder
 *    (with reason), prep-time->markPreparing.
 */
describe("DeliveryModerationService", () => {
  let prisma: MockPrismaClient;
  let adapterFactory: any;
  let configService: any;
  let authService: any;
  let logService: any;
  let adapter: any;
  let svc: DeliveryModerationService;

  const CONFIG = {
    id: "cfg-1",
    isEnabled: true,
    platform: "GETIR",
    tenantId: "t1",
    accessToken: "tok",
  };

  const orderRow = (over: any = {}) => ({
    id: "ord-1",
    tenantId: "t1",
    branchId: "b1",
    source: "GETIR",
    externalOrderId: "ext-9",
    status: OrderStatus.PENDING_APPROVAL,
    notes: null,
    ...over,
  });

  beforeEach(() => {
    prisma = mockPrismaClient();
    adapter = {
      acceptOrder: jest.fn().mockResolvedValue(undefined),
      rejectOrder: jest.fn().mockResolvedValue(undefined),
      markPreparing: jest.fn().mockResolvedValue(undefined),
    };
    adapterFactory = { getAdapter: jest.fn().mockReturnValue(adapter) };
    configService = {
      findOneInternal: jest.fn().mockResolvedValue(CONFIG),
      recordError: jest.fn().mockResolvedValue({}),
    };
    authService = { ensureValidToken: jest.fn().mockResolvedValue(CONFIG) };
    logService = { log: jest.fn().mockResolvedValue(undefined) };
    svc = new DeliveryModerationService(
      prisma as any,
      adapterFactory,
      configService,
      authService,
      logService,
    );
  });

  function arrange(order = orderRow()) {
    (prisma.order.findFirst as any).mockResolvedValue(order);
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockImplementation(
      async () =>
        ({
          ...order,
          status: OrderStatus.PENDING,
        }) as any,
    );
  }

  // ----------------------------------------------------------------------
  // Resolution / scoping
  // ----------------------------------------------------------------------

  describe("resolution + scoping", () => {
    it("404s when the order is not found (e.g. wrong tenant)", async () => {
      (prisma.order.findFirst as any).mockResolvedValue(null);
      await expect(svc.acceptOrder("t1", "ord-x")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(adapter.acceptOrder).not.toHaveBeenCalled();
    });

    it("scopes the lookup by id AND tenantId", async () => {
      arrange();
      await svc.acceptOrder("t1", "ord-1");
      expect(prisma.order.findFirst).toHaveBeenCalledWith({
        where: { id: "ord-1", tenantId: "t1" },
      });
    });

    it("400s when the order is not a platform order (no source)", async () => {
      (prisma.order.findFirst as any).mockResolvedValue(
        orderRow({ source: null }),
      );
      await expect(svc.acceptOrder("t1", "ord-1")).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(adapter.acceptOrder).not.toHaveBeenCalled();
    });

    it("400s when the disabled integration is used", async () => {
      arrange();
      configService.findOneInternal.mockResolvedValue({
        ...CONFIG,
        isEnabled: false,
      });
      await expect(svc.acceptOrder("t1", "ord-1")).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(adapter.acceptOrder).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------------
  // Accept
  // ----------------------------------------------------------------------

  describe("acceptOrder", () => {
    it("calls adapter.acceptOrder with the fresh config + external id, then advances to PENDING", async () => {
      arrange();
      await svc.acceptOrder("t1", "ord-1");

      expect(authService.ensureValidToken).toHaveBeenCalledWith("cfg-1");
      expect(adapter.acceptOrder).toHaveBeenCalledWith(CONFIG, "ext-9");
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: "ord-1", tenantId: "t1" },
        data: expect.objectContaining({
          status: OrderStatus.PENDING,
          requiresApproval: false,
        }),
      });
      const okLog = logService.log.mock.calls.find(
        (c: any[]) => c[0].success === true,
      );
      expect(okLog[0]).toMatchObject({
        action: PlatformLogAction.ORDER_ACCEPTED,
        externalId: "ext-9",
      });
    });

    it("records the prep time in the same accept when provided", async () => {
      arrange();
      await svc.acceptOrder("t1", "ord-1", 20);
      const okLog = logService.log.mock.calls.find(
        (c: any[]) => c[0].success === true,
      );
      expect(okLog[0].request).toEqual({ prepTimeMinutes: 20 });
    });

    it("is idempotent: an already-accepted order is a no-op (no platform call)", async () => {
      arrange(orderRow({ status: OrderStatus.PREPARING }));
      const out = await svc.acceptOrder("t1", "ord-1");
      expect((out as any).alreadyAccepted).toBe(true);
      expect(adapter.acceptOrder).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it("refuses to accept a cancelled order", async () => {
      arrange(orderRow({ status: OrderStatus.CANCELLED }));
      await expect(svc.acceptOrder("t1", "ord-1")).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(adapter.acceptOrder).not.toHaveBeenCalled();
    });

    it("rejects an invalid prep time before touching the platform", async () => {
      arrange();
      await expect(svc.acceptOrder("t1", "ord-1", 0)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(svc.acceptOrder("t1", "ord-1", 999)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(adapter.acceptOrder).not.toHaveBeenCalled();
    });

    it("HONESTY: on adapter failure, does NOT advance status, logs failure + bumps circuit-breaker, and rethrows", async () => {
      arrange();
      adapter.acceptOrder.mockRejectedValue(new Error("platform 503"));

      await expect(svc.acceptOrder("t1", "ord-1")).rejects.toThrow(
        "platform 503",
      );

      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(configService.recordError).toHaveBeenCalledWith(
        "cfg-1",
        expect.stringContaining("moderation:"),
      );
      const failLog = logService.log.mock.calls.find(
        (c: any[]) => c[0].success === false,
      );
      expect(failLog[0]).toMatchObject({
        success: false,
        error: "platform 503",
      });
    });

    it("rethrows when no valid token can be obtained, without advancing status", async () => {
      arrange();
      authService.ensureValidToken.mockResolvedValue(null);
      await expect(svc.acceptOrder("t1", "ord-1")).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(adapter.acceptOrder).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------------
  // Reject
  // ----------------------------------------------------------------------

  describe("rejectOrder", () => {
    it("requires a non-empty reason", async () => {
      await expect(svc.rejectOrder("t1", "ord-1", "  ")).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.order.findFirst).not.toHaveBeenCalled();
    });

    it("sends the reason to the platform AND records it, then cancels internally", async () => {
      arrange();
      await svc.rejectOrder("t1", "ord-1", "Out of stock");

      expect(adapter.rejectOrder).toHaveBeenCalledWith(
        CONFIG,
        "ext-9",
        "Out of stock",
      );
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: "ord-1", tenantId: "t1" },
        data: expect.objectContaining({ status: OrderStatus.CANCELLED }),
      });
      const okLog = logService.log.mock.calls.find(
        (c: any[]) => c[0].success === true,
      );
      expect(okLog[0]).toMatchObject({
        action: PlatformLogAction.ORDER_REJECTED,
        request: { reason: "Out of stock" },
      });
    });

    it("is idempotent: rejecting an already-cancelled order is a no-op", async () => {
      arrange(orderRow({ status: OrderStatus.CANCELLED }));
      const out = await svc.rejectOrder("t1", "ord-1", "dup");
      expect((out as any).alreadyRejected).toBe(true);
      expect(adapter.rejectOrder).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it("refuses to reject an order already in the kitchen (PREPARING)", async () => {
      arrange(orderRow({ status: OrderStatus.PREPARING }));
      await expect(
        svc.rejectOrder("t1", "ord-1", "too late"),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(adapter.rejectOrder).not.toHaveBeenCalled();
    });

    it("HONESTY: adapter failure leaves status unchanged and rethrows", async () => {
      arrange();
      adapter.rejectOrder.mockRejectedValue(new Error("platform 500"));
      await expect(svc.rejectOrder("t1", "ord-1", "x")).rejects.toThrow(
        "platform 500",
      );
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(configService.recordError).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------------
  // Prep time
  // ----------------------------------------------------------------------

  describe("setPrepTime", () => {
    it("marks preparing on the platform and advances PENDING -> PREPARING", async () => {
      arrange(orderRow({ status: OrderStatus.PENDING }));
      await svc.setPrepTime("t1", "ord-1", 15);

      expect(adapter.markPreparing).toHaveBeenCalledWith(CONFIG, "ext-9");
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: "ord-1", tenantId: "t1" },
        data: expect.objectContaining({ status: OrderStatus.PREPARING }),
      });
      const okLog = logService.log.mock.calls.find(
        (c: any[]) => c[0].success === true,
      );
      expect(okLog[0]).toMatchObject({
        action: PlatformLogAction.ORDER_PREPARING,
        request: { prepTimeMinutes: 15 },
      });
    });

    it("does not bounce a READY order backwards, but still records minutes", async () => {
      arrange(orderRow({ status: OrderStatus.READY }));
      await svc.setPrepTime("t1", "ord-1", 10);
      const data = (prisma.order.updateMany as any).mock.calls[0][0].data;
      expect(data.status).toBeUndefined();
      expect(adapter.markPreparing).toHaveBeenCalled();
    });

    it("400s for a not-yet-accepted (PENDING_APPROVAL) order", async () => {
      arrange(orderRow({ status: OrderStatus.PENDING_APPROVAL }));
      await expect(svc.setPrepTime("t1", "ord-1", 10)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(adapter.markPreparing).not.toHaveBeenCalled();
    });

    it("rejects an invalid minutes value before any platform call", async () => {
      arrange(orderRow({ status: OrderStatus.PENDING }));
      await expect(svc.setPrepTime("t1", "ord-1", -5)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(adapter.markPreparing).not.toHaveBeenCalled();
    });
  });
});
