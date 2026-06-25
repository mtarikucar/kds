import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/node";

// Sentry.captureException/captureMessage are non-configurable on the real
// module; mock the surface the recovery + webhook paths touch.
jest.mock("@sentry/node", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";
import { SelfPayWebhookService } from "./self-pay-webhook.service";
import { SelfPayRecoveryService } from "./self-pay-recovery.service";

/**
 * Spec for the sweep-3 finding #4 fix: QR self-pay PayTR inquiry-recovery.
 *
 * Covers the two halves of the fix:
 *   (A) SelfPayWebhookService.handleWebhookSuccess re-settles an
 *       EXPIRED-but-actually-PAID intent (late/lost callback) instead of
 *       dropping it, and is idempotent against a concurrent webhook retry.
 *   (B) SelfPayRecoveryService (hourly cron) inquires PayTR for terminal
 *       rows and replays settlement on success.
 */
describe("self-pay inquiry-recovery (sweep-3 #4)", () => {
  const TENANT_ID = "tenant-1";
  const SESSION_ID = "session-1";

  let prisma: MockPrismaClient;
  let paymentsService: { payByItems: jest.Mock };

  /** $transaction(fn) runs its callback against the same mock inline. */
  function wireTransaction() {
    (prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (fn: any) => {
        if (typeof fn === "function") return fn(prisma);
        return Promise.all(fn);
      },
    );
    (prisma.$queryRaw as unknown as jest.Mock).mockResolvedValue([
      { id: "order-A" },
    ]);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = mockPrismaClient();
    paymentsService = {
      payByItems: jest.fn().mockResolvedValue({ id: "pay-1" }),
    };
  });

  // ────────────────────────────────────────────────────────────────
  // (A) webhook re-settles an EXPIRED-but-PAID intent
  // ────────────────────────────────────────────────────────────────
  describe("handleWebhookSuccess — recovery replay", () => {
    function makeWebhook() {
      return new SelfPayWebhookService(prisma as any, paymentsService as any);
    }

    function expiredIntent(overrides: Record<string, unknown> = {}) {
      return {
        id: "intent-1",
        merchantOid: "SPx",
        status: "EXPIRED",
        failureReason: "TTL expired (sweeper)",
        tenantId: TENANT_ID,
        sessionId: SESSION_ID,
        customerPhone: "+905551112233",
        amount: new Prisma.Decimal("25.00"),
        itemsByOrder: [
          { orderId: "order-A", items: [{ orderItemId: "oi-1", quantity: 1 }] },
        ],
        ...overrides,
      };
    }

    it("re-opens an EXPIRED intent PayTR confirmed paid, settles it, flips to SUCCEEDED, and alerts the near-miss", async () => {
      wireTransaction();
      const svc = makeWebhook();
      (prisma.pendingSelfPayment.findUnique as any).mockResolvedValue(
        expiredIntent(),
      );
      // reopen EXPIRED→PENDING succeeds (1 row), success-write succeeds.
      (prisma.pendingSelfPayment.updateMany as any).mockResolvedValue({
        count: 1,
      });
      // pre-validate: item exists, qty 1, nothing paid.
      (prisma.orderItem.findMany as any).mockResolvedValue([
        { id: "oi-1", quantity: 1, orderItemPayments: [] },
      ]);
      // booked-sum reconciliation read.
      (prisma.payment.aggregate as any).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal("25.00") },
      });

      await svc.handleWebhookSuccess("SPx", "card");

      // Money was actually booked (NOT dropped).
      expect(paymentsService.payByItems).toHaveBeenCalledTimes(1);
      const [orderId, body] = paymentsService.payByItems.mock.calls[0];
      expect(orderId).toBe("order-A");
      // Idempotency key still per-order so the late webhook can't double-book.
      expect(body.idempotencyKey).toBe("selfpay:SPx:order-A");

      // The reopen write targets only still-terminal rows.
      const reopenWrite = (
        prisma.pendingSelfPayment.updateMany as any
      ).mock.calls.find((c: any[]) => c[0].data.status === "PENDING");
      expect(reopenWrite[0].where).toEqual({
        id: "intent-1",
        status: { in: ["EXPIRED", "FAILED"] },
      });

      // Then promoted to SUCCEEDED via the compound-WHERE success write.
      const successWrite = (
        prisma.pendingSelfPayment.updateMany as any
      ).mock.calls.find((c: any[]) => c[0].data.status === "SUCCEEDED");
      expect(successWrite[0].where).toEqual({
        id: "intent-1",
        status: { in: ["PENDING", "PARTIALLY_SETTLED"] },
      });

      // Near-miss surfaced for ops.
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "SELF_PAY_RECOVERED_ON_WEBHOOK",
        expect.objectContaining({
          tags: expect.objectContaining({
            event: "SELF_PAY_RECOVERED_ON_WEBHOOK",
          }),
        }),
      );
    });

    it("does NOT double-settle when the webhook ALSO lands after recovery already reopened+settled (reopen race loses)", async () => {
      const svc = makeWebhook();
      (prisma.pendingSelfPayment.findUnique as any).mockResolvedValue(
        expiredIntent(),
      );
      // The reopen race is lost: another caller already reopened + settled,
      // so the compound-WHERE reopen matches 0 rows.
      (prisma.pendingSelfPayment.updateMany as any).mockResolvedValue({
        count: 0,
      });

      await svc.handleWebhookSuccess("SPx", "card");

      // We bailed before settling — no double charge.
      expect(paymentsService.payByItems).not.toHaveBeenCalled();
      // Only the (failed) reopen attempt happened; no SUCCEEDED/FAILED write.
      const nonReopenWrites = (
        prisma.pendingSelfPayment.updateMany as any
      ).mock.calls.filter((c: any[]) => c[0].data.status !== "PENDING");
      expect(nonReopenWrites).toHaveLength(0);
    });

    it("still short-circuits a truly terminal SUCCEEDED intent (PayTR retry no-op)", async () => {
      const svc = makeWebhook();
      (prisma.pendingSelfPayment.findUnique as any).mockResolvedValue(
        expiredIntent({ status: "SUCCEEDED", failureReason: null }),
      );

      await svc.handleWebhookSuccess("SPx", "card");

      expect(paymentsService.payByItems).not.toHaveBeenCalled();
      expect(prisma.pendingSelfPayment.updateMany).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // (B) recovery cron
  // ────────────────────────────────────────────────────────────────
  describe("SelfPayRecoveryService — hourly cron", () => {
    let paytr: { inquiryStatus: jest.Mock };
    let webhook: { handleWebhookSuccess: jest.Mock };
    let svc: SelfPayRecoveryService;

    beforeEach(() => {
      // The advisory-lock wrapper now runs inside ONE interactive
      // $transaction and takes a transaction-scoped lock via
      // tx.$queryRawUnsafe("...pg_try_advisory_xact_lock..."). Run the
      // callback inline against the same mock (tx === prisma) so the
      // $queryRawUnsafe stub below drives the lock; this also runs any
      // inner service-owned $transaction usage. Preserve the array form.
      (prisma.$transaction as unknown as jest.Mock).mockImplementation(
        async (fn: any) => {
          if (typeof fn === "function") return fn(prisma);
          return Promise.all(fn);
        },
      );
      // Advisory lock acquired (winner): the xact-lock query returns locked.
      (prisma.$queryRawUnsafe as unknown as jest.Mock).mockResolvedValue([
        { locked: true },
      ]);
      paytr = { inquiryStatus: jest.fn() };
      webhook = { handleWebhookSuccess: jest.fn().mockResolvedValue(undefined) };
      svc = new SelfPayRecoveryService(
        prisma as any,
        paytr as any,
        webhook as any,
      );
    });

    it("inquires PayTR for an EXPIRED row and replays settlement on success", async () => {
      (prisma.pendingSelfPayment.findMany as any).mockResolvedValue([
        { id: "intent-1", merchantOid: "SPx", tenantId: TENANT_ID },
      ]);
      paytr.inquiryStatus.mockResolvedValue({
        status: "success",
        paymentType: "card",
        raw: {},
      });

      await svc.recoverStuckIntents();

      expect(paytr.inquiryStatus).toHaveBeenCalledWith("SPx");
      expect(webhook.handleWebhookSuccess).toHaveBeenCalledWith("SPx", "card");
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "SELF_PAY_INQUIRY_PAID_BUT_EXPIRED",
        expect.objectContaining({
          tags: expect.objectContaining({
            event: "SELF_PAY_INQUIRY_PAID_BUT_EXPIRED",
          }),
        }),
      );
    });

    it("pins a row to FAILED when PayTR confirms it was never charged", async () => {
      (prisma.pendingSelfPayment.findMany as any).mockResolvedValue([
        { id: "intent-1", merchantOid: "SPx", tenantId: TENANT_ID },
      ]);
      paytr.inquiryStatus.mockResolvedValue({ status: "failed", raw: {} });
      (prisma.pendingSelfPayment.updateMany as any).mockResolvedValue({
        count: 1,
      });

      await svc.recoverStuckIntents();

      expect(webhook.handleWebhookSuccess).not.toHaveBeenCalled();
      const failWrite = (prisma.pendingSelfPayment.updateMany as any).mock
        .calls[0];
      expect(failWrite[0].data.status).toBe("FAILED");
      expect(failWrite[0].data.failureReason).toBe("inquiry_confirmed_unpaid");
      expect(failWrite[0].where.status).toEqual({ in: ["PENDING", "EXPIRED"] });
    });

    it("leaves a row alone on pending/unknown inquiry", async () => {
      (prisma.pendingSelfPayment.findMany as any).mockResolvedValue([
        { id: "intent-1", merchantOid: "SPx", tenantId: TENANT_ID },
      ]);
      paytr.inquiryStatus.mockResolvedValue({ status: "unknown", raw: {} });

      await svc.recoverStuckIntents();

      expect(webhook.handleWebhookSuccess).not.toHaveBeenCalled();
      expect(prisma.pendingSelfPayment.updateMany).not.toHaveBeenCalled();
    });

    it("isolates per-row failure: a throw on row #1 does not abort row #2", async () => {
      (prisma.pendingSelfPayment.findMany as any).mockResolvedValue([
        { id: "intent-1", merchantOid: "SPa", tenantId: TENANT_ID },
        { id: "intent-2", merchantOid: "SPb", tenantId: TENANT_ID },
      ]);
      paytr.inquiryStatus
        .mockRejectedValueOnce(new Error("paytr 500"))
        .mockResolvedValueOnce({ status: "success", paymentType: "card", raw: {} });

      await svc.recoverStuckIntents();

      // Row #2 still got recovered despite row #1 throwing.
      expect(webhook.handleWebhookSuccess).toHaveBeenCalledWith("SPb", "card");
    });

    it("no-ops cleanly when there are no candidates", async () => {
      (prisma.pendingSelfPayment.findMany as any).mockResolvedValue([]);

      await svc.recoverStuckIntents();

      expect(paytr.inquiryStatus).not.toHaveBeenCalled();
    });

    it("skips entirely when the advisory lock is held by another replica", async () => {
      (prisma.$queryRawUnsafe as unknown as jest.Mock).mockResolvedValue([
        { locked: false },
      ]);

      await svc.recoverStuckIntents();

      expect(prisma.pendingSelfPayment.findMany).not.toHaveBeenCalled();
    });
  });
});
