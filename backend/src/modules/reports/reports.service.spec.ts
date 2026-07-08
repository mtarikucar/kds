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

/**
 * Menu engineering — classic profitability × popularity quadrant. Popularity
 * is "high" at ≥70% of average units-sold; profitability "high" at ≥ average
 * unit margin. Un-costed products are excluded from the averages/quadrant.
 */
describe('ReportsService.getMenuEngineering', () => {
  let prisma: MockPrismaClient;
  let svc: ReportsService;
  const start = new Date('2026-06-01T00:00:00Z');
  const end = new Date('2026-06-30T23:59:59Z');

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new ReportsService(prisma as any);
  });

  it('classifies items into Star / Plow-horse / Puzzle by margin × popularity', async () => {
    (prisma.orderItem.groupBy as any).mockResolvedValue([
      { productId: 'A', _sum: { quantity: 100, subtotal: 2000 } },
      { productId: 'B', _sum: { quantity: 100, subtotal: 1000 } },
      { productId: 'C', _sum: { quantity: 5, subtotal: 150 } },
    ]);
    (prisma.product.findMany as any).mockResolvedValue([
      { id: 'A', name: 'A', price: 20, costPrice: 5, category: { name: 'Main' } },  // margin 15, popular
      { id: 'B', name: 'B', price: 10, costPrice: 8, category: { name: 'Main' } },  // margin 2, popular
      { id: 'C', name: 'C', price: 30, costPrice: 5, category: { name: 'Main' } },  // margin 25, unpopular
    ]);

    const res = await svc.getMenuEngineering('t1', start, end);

    const byId = Object.fromEntries(res.items.map((i: any) => [i.productId, i]));
    expect(byId['A'].classification).toBe('STAR');       // high pop + high margin
    expect(byId['B'].classification).toBe('PLOWHORSE');   // high pop + low margin
    expect(byId['C'].classification).toBe('PUZZLE');      // low pop + high margin
    expect(byId['A'].unitMargin).toBe(15);
    expect(byId['A'].totalContribution).toBe(1500);
    expect(res.counts.STAR).toBe(1);
    expect(res.counts.PLOWHORSE).toBe(1);
    expect(res.counts.PUZZLE).toBe(1);
  });

  it('separates un-costed products and excludes them from the quadrant', async () => {
    (prisma.orderItem.groupBy as any).mockResolvedValue([
      { productId: 'A', _sum: { quantity: 10, subtotal: 200 } },
      { productId: 'X', _sum: { quantity: 50, subtotal: 500 } },
    ]);
    (prisma.product.findMany as any).mockResolvedValue([
      { id: 'A', name: 'A', price: 20, costPrice: 5, category: { name: 'Main' } },
      { id: 'X', name: 'X', price: 10, costPrice: null, category: { name: 'Main' } }, // no cost basis
    ]);

    const res = await svc.getMenuEngineering('t1', start, end);

    expect(res.items).toHaveLength(1);
    expect(res.items[0].productId).toBe('A');
    expect(res.uncosted).toHaveLength(1);
    expect(res.uncosted[0].productId).toBe('X');
    expect(res.counts.uncosted).toBe(1);
  });
});

/**
 * Tips report — totals + per-tender breakdown. Tips are Payment.tipAmount,
 * recorded separately from the goods amount, so they never double-count sales.
 */
describe('ReportsService.getTipsReport', () => {
  let prisma: MockPrismaClient;
  let svc: ReportsService;
  const start = new Date('2026-06-01T00:00:00Z');
  const end = new Date('2026-06-30T23:59:59Z');

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new ReportsService(prisma as any);
  });

  it('totals tips and breaks them down by tender, sorted desc', async () => {
    (prisma.payment.groupBy as any).mockResolvedValue([
      { method: 'CASH', _sum: { tipAmount: 20 }, _count: 2 },
      { method: 'CARD', _sum: { tipAmount: 80 }, _count: 4 },
    ]);
    const res = await svc.getTipsReport('t1', start, end);
    expect(res.totalTips).toBe(100);
    expect(res.tipCount).toBe(6);
    expect(res.byMethod[0]).toMatchObject({ method: 'CARD', tips: 80, count: 4 });
    expect(res.byMethod[1]).toMatchObject({ method: 'CASH', tips: 20 });
  });
});

/**
 * Period-over-period comparison — current window vs the immediately preceding
 * equal-length window, with absolute + % change per metric.
 */
describe('ReportsService.getSalesComparison', () => {
  let prisma: MockPrismaClient;
  let svc: ReportsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new ReportsService(prisma as any);
  });

  it('computes deltas vs the previous equal-length window', async () => {
    jest.spyOn(svc, 'getSalesSummary')
      .mockResolvedValueOnce({ totalSales: 1200, totalOrders: 100, averageOrderValue: 12 } as any)
      .mockResolvedValueOnce({ totalSales: 1000, totalOrders: 80, averageOrderValue: 12.5 } as any);
    jest.spyOn(svc, 'getCogsReport')
      .mockResolvedValueOnce({ cogs: 360, grossProfit: 840, foodCostPct: 30 } as any)
      .mockResolvedValueOnce({ cogs: 320, grossProfit: 680, foodCostPct: 32 } as any);

    const res = await svc.getSalesComparison(
      't1',
      new Date('2026-06-16T00:00:00Z'),
      new Date('2026-06-30T00:00:00Z'),
    );

    const sales = res.metrics.find((m: any) => m.metric === 'totalSales');
    expect(sales.current).toBe(1200);
    expect(sales.previous).toBe(1000);
    expect(sales.change).toBe(200);
    expect(sales.changePct).toBe(20);
    expect(res.foodCostPct).toEqual({ current: 30, previous: 32 });
    // The previous window is the 14 days immediately before the current start.
    expect(res.previous.endDate.getTime()).toBe(new Date('2026-06-16T00:00:00Z').getTime());
  });
});
