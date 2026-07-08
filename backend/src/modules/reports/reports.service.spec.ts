import { BadRequestException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * Iter-64 regression — getDateRange used to accept arbitrarily wide
 * windows, including `startDate=2020-01-01 / endDate=now`. The
 * downstream findMany calls (getSalesSummary, getOrdersByHour,
 * getCustomerAnalytics, getStaffPerformance) load every PAID order in
 * the window into memory for JS-side bucketing. A tenant with 1K
 * orders/day already crosses 366K rows in a 1-year window — past that
 * cap one request is a one-shot DoS lever.
 *
 * iter-64 caps at REPORT_MAX_WINDOW_DAYS=366 and surfaces malformed /
 * inverted ranges as 400s instead of letting NaN.gte produce a
 * confusing empty payload.
 */
describe('ReportsService.getDateRange (iter-64)', () => {
  let prisma: MockPrismaClient;
  let svc: ReportsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new ReportsService(prisma as any);
    prisma.tenant.findUnique.mockResolvedValue({ timezone: 'UTC' } as any);
    // Every report-level findMany / aggregate / groupBy resolves to
    // empty so the public methods exercise getDateRange cleanly.
    (prisma.order.findMany as any).mockResolvedValue([]);
    (prisma.order.aggregate as any).mockResolvedValue({ _sum: {}, _count: 0 });
    (prisma.payment.groupBy as any).mockResolvedValue([]);
  });

  it('accepts a window inside the cap', async () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-06-30T23:59:59Z');
    await expect(
      svc.getSalesSummary('t1', start, end),
    ).resolves.not.toThrow();
  });

  it('rejects a 367-day window (just over the cap)', async () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2026-01-03T00:00:00Z'); // 367 days
    await expect(svc.getSalesSummary('t1', start, end)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a 5-year span (the load-bearing one-shot DoS guard)', async () => {
    const start = new Date('2020-01-01T00:00:00Z');
    const end = new Date('2025-01-01T00:00:00Z');
    await expect(svc.getSalesSummary('t1', start, end)).rejects.toThrow(
      /366 days/,
    );
  });

  it('rejects inverted ranges (endDate before startDate)', async () => {
    const start = new Date('2026-06-30T00:00:00Z');
    const end = new Date('2026-01-01T00:00:00Z');
    await expect(svc.getSalesSummary('t1', start, end)).rejects.toThrow(
      /before or equal/,
    );
  });

  it('rejects Invalid Date payloads (NaN-getTime guard)', async () => {
    const start = new Date('not-a-date');
    const end = new Date('2026-06-30T00:00:00Z');
    await expect(svc.getSalesSummary('t1', start, end)).rejects.toThrow(
      /valid dates/,
    );
  });

  it('defaults the window (today in tenant TZ) when no dates are given', async () => {
    await expect(svc.getSalesSummary('t1')).resolves.not.toThrow();
    // Defaults path consults the tenant timezone; make sure that lookup
    // actually fires so a future refactor that drops the per-tenant
    // midnight calculation fails this test.
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, select: { timezone: true } }),
    );
  });
});

/**
 * COGS / food-cost % — the headline back-office KPI. COGS is read from the
 * ingredient-movement ledger (each ORDER_DEDUCTION already carries its
 * FIFO-weighted costPerUnit), so the report is a single aggregate, not a
 * re-computation. `quantity` is negative for consumption, so the raw SUM is
 * negative and the report negates it.
 */
describe('ReportsService.getCogsReport', () => {
  let prisma: MockPrismaClient;
  let svc: ReportsService;
  const start = new Date('2026-06-01T00:00:00Z');
  const end = new Date('2026-06-30T23:59:59Z');

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new ReportsService(prisma as any);
  });

  it('negates ledger net-consumption into COGS and computes food-cost %', async () => {
    (prisma.order.aggregate as any).mockResolvedValue({ _sum: { finalAmount: 1000 }, _count: 50 });
    (prisma.$queryRaw as any).mockResolvedValue([{ cogs_net: '-300', waste_net: '-20' }]);

    const res = await svc.getCogsReport('t1', start, end);

    expect(res.totalSales).toBe(1000);
    expect(res.totalOrders).toBe(50);
    expect(res.cogs).toBe(300);
    expect(res.wasteCost).toBe(20);
    expect(res.grossProfit).toBe(700);
    expect(res.foodCostPct).toBe(30);
    expect(res.wasteCostPct).toBe(2);
    expect(res.grossMarginPct).toBe(70);
  });

  it('returns null percentages when there are no sales (avoids divide-by-zero)', async () => {
    (prisma.order.aggregate as any).mockResolvedValue({ _sum: { finalAmount: null }, _count: 0 });
    (prisma.$queryRaw as any).mockResolvedValue([{ cogs_net: '0', waste_net: '0' }]);

    const res = await svc.getCogsReport('t1', start, end);
    expect(res.totalSales).toBe(0);
    expect(res.foodCostPct).toBeNull();
    expect(res.grossMarginPct).toBeNull();
  });
});
