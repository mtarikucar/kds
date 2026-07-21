import { DeliveryApprovalTimeoutScheduler } from "./delivery-approval-timeout.scheduler";
import { DeliveryModerationService } from "../services/delivery-moderation.service";
import { OrderStatus } from "../../../common/constants/order-status.enum";
import { mockPrismaClient } from "../../../common/test/prisma-mock.service";

/**
 * Spec for the PENDING_APPROVAL auto-reject cron. A delivery order that no
 * operator approves within DELIVERY_APPROVAL_TIMEOUT_MINUTES (default 15) is
 * auto-rejected — pushed back to the platform (cancel) so the customer gets a
 * fast refund instead of waiting on a ghost order. Load-bearing contracts:
 *   - reuses DeliveryModerationService.rejectOrder (platform push + audit +
 *     idempotency), never re-implements the reject
 *   - race guard: never cancels an order the operator accepted between the
 *     query snapshot and the reject
 *   - env escape hatch: 0 disables the tick entirely
 *   - the advisory lock + isRunning shell prevents cross-replica / re-entrant
 *     double-reject
 */
describe("DeliveryApprovalTimeoutScheduler", () => {
  const ENV_KEY = "DELIVERY_APPROVAL_TIMEOUT_MINUTES";
  const ORIGINAL = process.env[ENV_KEY];

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = ORIGINAL;
    jest.restoreAllMocks();
  });

  function make({
    locked = true,
    stale = [] as any[],
    statusById = {} as Record<string, string>,
  } = {}) {
    const prisma = mockPrismaClient();
    // v2 withAdvisoryLock holds the lock inside a $transaction that runs the
    // callback; the mock invokes it with the same client (tx === prisma), and
    // pg_try_advisory_xact_lock returns { locked } to gate the work.
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      typeof cb === "function" ? cb(prisma) : Promise.all(cb),
    );
    (prisma.$queryRawUnsafe as any).mockImplementation(async (sql: string) =>
      sql.includes("pg_try_advisory") ? [{ locked }] : [],
    );
    (prisma.order.findMany as any).mockResolvedValue(stale);
    (prisma.order.findUnique as any).mockImplementation(
      async ({ where: { id } }: any) => ({
        status: statusById[id] ?? OrderStatus.PENDING_APPROVAL,
      }),
    );

    const moderation = {
      rejectOrder: jest.fn().mockResolvedValue({}),
    } as unknown as DeliveryModerationService;

    const sched = new DeliveryApprovalTimeoutScheduler(
      prisma as any,
      moderation,
    );
    return { sched, prisma, moderation };
  }

  it("auto-rejects a stale PENDING_APPROVAL delivery order via moderation", async () => {
    process.env[ENV_KEY] = "15";
    const { sched, moderation } = make({
      stale: [
        { id: "o1", tenantId: "t1", source: "YEMEKSEPETI", externalOrderId: "x1" },
      ],
    });

    await sched.rejectStaleApprovals();

    expect(moderation.rejectOrder).toHaveBeenCalledWith(
      "t1",
      "o1",
      expect.stringContaining("otomatik iptal"),
    );
  });

  it("queries with a createdAt cutoff derived from the env threshold", async () => {
    process.env[ENV_KEY] = "20";
    const { sched, prisma } = make({ stale: [] });

    const before = Date.now();
    await sched.rejectStaleApprovals();

    const arg = (prisma.order.findMany as jest.Mock).mock.calls[0][0];
    const cutoff = arg.where.createdAt.lt as Date;
    const expected = before - 20 * 60_000;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5_000);
    expect(arg.where.status).toBe(OrderStatus.PENDING_APPROVAL);
    expect(arg.where.requiresApproval).toBe(true);
  });

  it("is disabled when the threshold is 0 (no query, no reject)", async () => {
    process.env[ENV_KEY] = "0";
    const { sched, prisma, moderation } = make({
      stale: [{ id: "o1", tenantId: "t1", source: "GETIR", externalOrderId: "x" }],
    });

    await sched.rejectStaleApprovals();

    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(moderation.rejectOrder).not.toHaveBeenCalled();
  });

  it("falls back to the 15-min default when the env var is missing/garbage", async () => {
    process.env[ENV_KEY] = "not-a-number";
    const { sched, prisma } = make({ stale: [] });

    const before = Date.now();
    await sched.rejectStaleApprovals();

    const arg = (prisma.order.findMany as jest.Mock).mock.calls[0][0];
    const cutoff = arg.where.createdAt.lt as Date;
    const expected = before - 15 * 60_000;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5_000);
  });

  it("does NOT reject an order the operator accepted after the query snapshot (race guard)", async () => {
    process.env[ENV_KEY] = "15";
    const { sched, moderation } = make({
      stale: [
        { id: "o1", tenantId: "t1", source: "GETIR", externalOrderId: "x1" },
      ],
      statusById: { o1: OrderStatus.PENDING }, // re-check sees it's now accepted
    });

    await sched.rejectStaleApprovals();

    expect(moderation.rejectOrder).not.toHaveBeenCalled();
  });

  it("continues after a reject failure (one bad order does not block the rest)", async () => {
    process.env[ENV_KEY] = "15";
    const { sched, moderation } = make({
      stale: [
        { id: "bad", tenantId: "t1", source: "TRENDYOL", externalOrderId: "xa" },
        { id: "good", tenantId: "t1", source: "TRENDYOL", externalOrderId: "xb" },
      ],
    });
    (moderation.rejectOrder as jest.Mock)
      .mockRejectedValueOnce(new Error("platform 500"))
      .mockResolvedValueOnce({});

    await sched.rejectStaleApprovals();

    expect(moderation.rejectOrder).toHaveBeenCalledTimes(2);
    expect(moderation.rejectOrder).toHaveBeenNthCalledWith(
      2,
      "t1",
      "good",
      expect.any(String),
    );
  });

  it("skips work when another replica holds the advisory lock", async () => {
    process.env[ENV_KEY] = "15";
    const { sched, prisma, moderation } = make({
      locked: false,
      stale: [{ id: "o1", tenantId: "t1", source: "GETIR", externalOrderId: "x" }],
    });

    await sched.rejectStaleApprovals();

    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(moderation.rejectOrder).not.toHaveBeenCalled();
  });

  it("skips a re-entrant tick while one is already in flight", async () => {
    process.env[ENV_KEY] = "15";
    const { sched, prisma } = make({ stale: [] });
    (sched as unknown as { isRunning: boolean }).isRunning = true;

    await sched.rejectStaleApprovals();

    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });
});
