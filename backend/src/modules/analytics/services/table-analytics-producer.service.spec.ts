import { Prisma } from "@prisma/client";
import { TableAnalyticsProducerService } from "./table-analytics-producer.service";

/**
 * The REAL producer of tableAnalytics rows. These specs prove it derives
 * metrics from genuine Order/Payment rows (never fabricated numbers) and that
 * a table-less / no-activity case writes an honest zero row instead of a mock.
 */
describe("TableAnalyticsProducerService", () => {
  const TENANT = "t-1";
  const BRANCH = "b-1";
  const TABLE = "tbl-1";

  let prisma: any;
  let svc: TableAnalyticsProducerService;

  beforeEach(() => {
    prisma = {
      order: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      tableAnalytics: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    svc = new TableAnalyticsProducerService(prisma);
  });

  it("skips when the paid order has no table (takeaway/delivery)", async () => {
    prisma.order.findFirst.mockResolvedValue({
      tableId: null,
      branchId: BRANCH,
      paidAt: new Date(),
    });

    await svc.recordTableAnalyticsForPaidOrder("o-1", TENANT);

    expect(prisma.tableAnalytics.upsert).not.toHaveBeenCalled();
  });

  it("never throws (best-effort post-commit) when the lookup fails", async () => {
    prisma.order.findFirst.mockRejectedValue(new Error("db down"));
    await expect(
      svc.recordTableAnalyticsForPaidOrder("o-1", TENANT),
    ).resolves.toBeUndefined();
  });

  it("writes an honest ZERO row (not mock) when the day has no paid orders", async () => {
    prisma.order.findMany.mockResolvedValue([]);

    await svc.recomputeTableDay(
      TENANT,
      BRANCH,
      TABLE,
      new Date("2026-06-20T10:00:00Z"),
    );

    const arg = prisma.tableAnalytics.upsert.mock.calls[0][0];
    expect(arg.create.totalSessions).toBe(0);
    expect(arg.create.ordersCount).toBe(0);
    expect(arg.create.utilizationScore).toBe(0);
    // Honest: empty all day, no fabricated occupancy.
    expect(arg.create.totalEmptyMinutes).toBe(12 * 60);
    expect(Number(arg.create.revenueGenerated)).toBe(0);
  });

  it("aggregates REAL revenue, sessions, occupied minutes and peak hours from paid orders", async () => {
    // Two paid orders on the table that day:
    //  - order A: created 12:00, paid 13:00 (60 min span), 100.00
    //  - order B: created 19:00, paid 19:30 (30 min span), 50.00
    prisma.order.findMany.mockResolvedValue([
      {
        finalAmount: new Prisma.Decimal("100.00"),
        createdAt: new Date(2026, 5, 20, 12, 0, 0),
        paidAt: new Date(2026, 5, 20, 13, 0, 0),
      },
      {
        finalAmount: new Prisma.Decimal("50.00"),
        createdAt: new Date(2026, 5, 20, 19, 0, 0),
        paidAt: new Date(2026, 5, 20, 19, 30, 0),
      },
    ]);

    await svc.recomputeTableDay(
      TENANT,
      BRANCH,
      TABLE,
      new Date(2026, 5, 20, 10, 0, 0),
    );

    const arg = prisma.tableAnalytics.upsert.mock.calls[0][0];
    const m = arg.create;

    expect(m.totalSessions).toBe(2);
    expect(m.ordersCount).toBe(2);
    expect(Number(m.revenueGenerated)).toBe(150);
    expect(Number(m.avgOrderValue)).toBe(75);
    // 60 + 30 minutes of real active service.
    expect(m.totalOccupiedMinutes).toBe(90);
    expect(m.totalDiningMinutes).toBe(90);
    // Idle requires telemetry → honest 0, not a guess.
    expect(m.totalIdleMinutes).toBe(0);
    expect(m.avgIdleDuration).toBeNull();
    expect(m.totalEmptyMinutes).toBe(12 * 60 - 90);
    // Peak hours are the real createdAt hours.
    expect(m.peakHours).toEqual({ 12: 1, 19: 1 });
    // utilization = 90 / 720 * 100
    expect(m.utilizationScore).toBeCloseTo((90 / 720) * 100, 5);
    // upsert keyed by (tableId, date) → idempotent recompute.
    expect(arg.where.tableId_date.tableId).toBe(TABLE);
  });

  it("caps utilizationScore at 100 even for an all-day occupied table", async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        finalAmount: new Prisma.Decimal("500.00"),
        createdAt: new Date(2026, 5, 20, 0, 0, 0),
        paidAt: new Date(2026, 5, 20, 23, 59, 0),
      },
    ]);

    await svc.recomputeTableDay(
      TENANT,
      BRANCH,
      TABLE,
      new Date(2026, 5, 20, 0, 0, 0),
    );

    const m = prisma.tableAnalytics.upsert.mock.calls[0][0].create;
    expect(m.utilizationScore).toBeLessThanOrEqual(100);
  });
});
