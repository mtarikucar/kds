import { Prisma } from '@prisma/client';
import { ZReportsService } from './z-reports.service';
import { ZReportAggregator } from './services/z-report-aggregator.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import { getTenantMidnight } from '../../common/helpers/timezone.helper';

/**
 * Iter-35 regression: generateAndSendReport must use the SAME tenant-
 * timezone midnight that the scheduler keys its "already sent today?"
 * lookup on. Earlier it used server-local `today.setHours(0,0,0,0)`
 * which produced a different UTC instant for any non-UTC tenant; the
 * scheduler then thought no report existed and re-entered every 15
 * minutes during the closing window, polluting logs with the service's
 * own dedup throws.
 */
describe('ZReportsService.generateAndSendReport (iter-35)', () => {
  let prisma: MockPrismaClient;
  let email: any;
  let svc: ZReportsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    email = { sendEmail: jest.fn().mockResolvedValue(true) };
    svc = new ZReportsService(prisma as any, email, { render: jest.fn() } as any, new ZReportAggregator());
  });

  it('uses getTenantMidnight to build reportDate (tenant timezone, not server)', async () => {
    // TR tenant. Server local doesn't matter — the helper returns the
    // UTC instant that equals tenant-local midnight.
    const TR = 'Europe/Istanbul';
    prisma.tenant.findUnique.mockResolvedValue({
      id: 't1',
      timezone: TR,
      reportEmailEnabled: false,
      reportEmails: [],
    } as any);

    // Hit the "existing report found" branch so we don't need to mock
    // the full generateReport path. The point of the test is the
    // reportDate key passed to findFirst.
    const expectedMidnight = getTenantMidnight(new Date(), TR);
    prisma.zReport.findFirst.mockResolvedValue({
      id: 'zr-existing',
      reportDate: expectedMidnight,
    } as any);

    const out = await svc.generateAndSendReport('t1', 'b1', 'user-1');

    expect(out.reportId).toBe('zr-existing');

    // Load-bearing: the findFirst's `where.reportDate` must equal the
    // tenant-midnight instant. If a future refactor reverts to
    // server-local midnight (e.g. `new Date(); .setHours(0,0,0,0)`),
    // this fails for any non-UTC tenant.
    const where = (prisma.zReport.findFirst as any).mock.calls[0][0].where;
    expect(where.tenantId).toBe('t1');
    expect(where.branchId).toBe('b1');
    expect(where.reportDate.getTime()).toBe(expectedMidnight.getTime());
  });

  it('falls back to UTC when tenant has no configured timezone', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 't1',
      timezone: null,
      reportEmailEnabled: false,
      reportEmails: [],
    } as any);
    const expectedMidnight = getTenantMidnight(new Date(), 'UTC');
    prisma.zReport.findFirst.mockResolvedValue({ id: 'zr-utc' } as any);

    await svc.generateAndSendReport('t1', 'b1', 'user-1');

    const where = (prisma.zReport.findFirst as any).mock.calls[0][0].where;
    expect(where.reportDate.getTime()).toBe(expectedMidnight.getTime());
  });

  it('uses the BRANCH timezone over the tenant timezone for reportDate (fake-working sweep #3)', async () => {
    // Tenant in Istanbul, branch in London. reportDate must key off the
    // branch (London) midnight — the per-branch-timezone fix. Pre-fix the
    // branch tz was never read and this would have keyed on Istanbul.
    prisma.tenant.findUnique.mockResolvedValue({
      id: 't1',
      timezone: 'Europe/Istanbul',
      reportEmailEnabled: false,
      reportEmails: [],
    } as any);
    prisma.branch.findFirst.mockResolvedValue({ timezone: 'Europe/London' } as any);

    const londonMidnight = getTenantMidnight(new Date(), 'Europe/London');
    const istanbulMidnight = getTenantMidnight(new Date(), 'Europe/Istanbul');
    prisma.zReport.findFirst.mockResolvedValue({ id: 'zr-london' } as any);

    await svc.generateAndSendReport('t1', 'b-london', 'user-1');

    const where = (prisma.zReport.findFirst as any).mock.calls[0][0].where;
    expect(where.reportDate.getTime()).toBe(londonMidnight.getTime());
    // London midnight != Istanbul midnight (different UTC offset), so this
    // also proves we did NOT fall back to the tenant tz.
    expect(where.reportDate.getTime()).not.toBe(istanbulMidnight.getTime());
  });

  it('falls back to the tenant timezone when the branch has none set', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 't1',
      timezone: 'Europe/Istanbul',
      reportEmailEnabled: false,
      reportEmails: [],
    } as any);
    // branch row exists but timezone is null -> fall back to tenant tz.
    prisma.branch.findFirst.mockResolvedValue({ timezone: null } as any);

    const istanbulMidnight = getTenantMidnight(new Date(), 'Europe/Istanbul');
    prisma.zReport.findFirst.mockResolvedValue({ id: 'zr-x' } as any);

    await svc.generateAndSendReport('t1', 'b1', 'user-1');

    const where = (prisma.zReport.findFirst as any).mock.calls[0][0].where;
    expect(where.reportDate.getTime()).toBe(istanbulMidnight.getTime());
  });
});

/**
 * Track-1 branch-scope hardening: every fiscal aggregation inside
 * generateReport must be filtered to the REPORT's branch, not just its
 * tenant. The report row is written with a NOT-NULL branchId; if the
 * underlying order/cash queries sum ALL branches, a multi-branch tenant
 * gets N identical reports each double/triple-counting money — per-branch
 * fiscal totals and cash reconciliation are wrong.
 *
 * The real signature is generateReport(tenantId, branchId, userId, dto);
 * the controller passes scope.branchId as the branchId argument, so the
 * branch we scope to is exactly that branchId.
 */
describe('ZReportsService.generateReport (track-1 branch scope)', () => {
  let prisma: MockPrismaClient;
  let email: any;
  let svc: ZReportsService;

  const TENANT = 't-1';
  const BRANCH = 'b-1';
  const USER = 'user-1';

  beforeEach(() => {
    prisma = mockPrismaClient();
    email = { sendEmail: jest.fn().mockResolvedValue(true) };
    svc = new ZReportsService(prisma as any, email, { render: jest.fn() } as any, new ZReportAggregator());

    // No existing report for the date -> proceed into aggregation.
    prisma.zReport.findFirst.mockResolvedValue(null);
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      timezone: 'UTC',
      currency: 'TRY',
    } as any);
    // Every aggregation returns empty so the math path is trivial.
    prisma.order.findMany.mockResolvedValue([] as any);
    prisma.cashDrawerMovement.findMany.mockResolvedValue([] as any);
    prisma.zReport.create.mockResolvedValue({ id: 'zr-new' } as any);
  });

  const dto = {
    reportDate: '2026-06-01T00:00:00.000Z',
    cashDrawerOpening: 0,
    cashDrawerClosing: 0,
    notes: 'test',
  };

  it('scopes the paid-order aggregation to the report branch', async () => {
    await svc.generateReport(TENANT, BRANCH, USER, dto as any);

    // The first order.findMany is the PAID-order pull that feeds every
    // payment / refund / tax / staff / category total.
    const paidWhere = (prisma.order.findMany as any).mock.calls[0][0].where;
    expect(paidWhere.tenantId).toBe(TENANT);
    expect(paidWhere.branchId).toBe(BRANCH);
  });

  it('scopes the cancelled-order aggregation to the report branch', async () => {
    await svc.generateReport(TENANT, BRANCH, USER, dto as any);

    const calls = (prisma.order.findMany as any).mock.calls.map(
      (c: any[]) => c[0].where,
    );
    const cancelledWhere = calls.find((w: any) => w.status === 'CANCELLED');
    expect(cancelledWhere).toBeDefined();
    expect(cancelledWhere.branchId).toBe(BRANCH);
  });

  it('scopes the open-order aggregation to the report branch', async () => {
    await svc.generateReport(TENANT, BRANCH, USER, dto as any);

    const calls = (prisma.order.findMany as any).mock.calls.map(
      (c: any[]) => c[0].where,
    );
    const openWhere = calls.find(
      (w: any) => w.status && Array.isArray(w.status.notIn),
    );
    expect(openWhere).toBeDefined();
    expect(openWhere.branchId).toBe(BRANCH);
  });

  it('scopes the cash-drawer-movement aggregation to the report branch', async () => {
    await svc.generateReport(TENANT, BRANCH, USER, dto as any);

    const cashWhere = (prisma.cashDrawerMovement.findMany as any).mock
      .calls[0][0].where;
    expect(cashWhere.tenantId).toBe(TENANT);
    expect(cashWhere.branchId).toBe(BRANCH);
  });

  /**
   * v3 branch-isolation FOUNDATION: reportNumber is unique PER BRANCH
   * (@@unique([tenantId, branchId, reportNumber])). Each branch closes its
   * own fiscal day, so two branches on the SAME date must produce DISTINCT
   * report numbers (the number embeds a stable per-branch token), and the
   * write carries the report's branchId.
   */
  it('two branches on the same date produce DISTINCT, branch-tagged report numbers', async () => {
    const captured: any[] = [];
    (prisma.zReport.create as any).mockImplementation(async (args: any) => {
      captured.push(args.data);
      return { id: `zr-${args.data.branchId}`, ...args.data };
    });

    await svc.generateReport(TENANT, 'branch-alpha', USER, dto as any);
    await svc.generateReport(TENANT, 'branch-beta', USER, dto as any);

    expect(captured).toHaveLength(2);
    // Same calendar day, different branch -> different reportNumber.
    expect(captured[0].reportNumber).not.toBe(captured[1].reportNumber);
    expect(captured[0].reportNumber).toMatch(/^Z-20260601-/);
    expect(captured[1].reportNumber).toMatch(/^Z-20260601-/);
    expect(captured[0].branchId).toBe('branch-alpha');
    expect(captured[1].branchId).toBe('branch-beta');
  });
});

/**
 * Characterization: pins the EXACT data object generateReport hands to
 * zReport.create for a non-trivial dataset. This is the golden test that
 * guards the aggregation/number-crunching split — every total (sales,
 * payment breakdown, refunds, order-type, cancelled, tax, cash
 * reconciliation, staff, category, top-products) and every money-rounding
 * boundary must be byte-for-byte identical before and after extracting the
 * pure aggregator. Decimal columns are asserted via .toString() so a
 * silent precision drift (Number vs Prisma.Decimal) would fail here.
 */
describe('ZReportsService.generateReport (characterization — aggregation totals)', () => {
  let prisma: MockPrismaClient;
  let email: any;
  let svc: ZReportsService;

  const TENANT = 't-1';
  const BRANCH = 'b-1';
  const USER = 'user-1';

  // Two paid orders across two staff, two categories, two tax rates,
  // mixed payment methods, one refunded payment. Amounts chosen so that
  // naive Number addition would drift (0.1 + 0.2 family) — the Decimal
  // path must keep them exact.
  const ordersFixture = [
    {
      id: 'o1',
      type: 'DINE_IN',
      totalAmount: '100.10',
      discount: '5.05',
      finalAmount: '95.05',
      userId: 'staff-A',
      user: { id: 'staff-A', firstName: 'Ann', lastName: 'A' },
      payments: [
        { status: 'COMPLETED', method: 'CASH', amount: '50.05' },
        { status: 'COMPLETED', method: 'CARD', amount: '45.00' },
        { status: 'REFUNDED', method: 'CARD', amount: '10.01' },
      ],
      orderItems: [
        {
          productId: 'p1',
          quantity: 2,
          subtotal: '60.06',
          taxRate: 10,
          taxAmount: '5.46',
          product: {
            name: 'Burger',
            categoryId: 'c1',
            category: { id: 'c1', name: 'Food' },
          },
        },
        {
          productId: 'p2',
          quantity: 1,
          subtotal: '35.04',
          taxRate: 20,
          taxAmount: '5.84',
          product: {
            name: 'Cola',
            categoryId: 'c2',
            category: { id: 'c2', name: 'Drinks' },
          },
        },
      ],
    },
    {
      id: 'o2',
      type: 'TAKEAWAY',
      totalAmount: '30.30',
      discount: '0.00',
      finalAmount: '30.30',
      userId: 'staff-B',
      user: { id: 'staff-B', firstName: 'Bob', lastName: 'B' },
      payments: [
        { status: 'COMPLETED', method: 'DIGITAL', amount: '30.30' },
      ],
      orderItems: [
        {
          productId: 'p1',
          quantity: 3,
          subtotal: '30.30',
          taxRate: 10,
          taxAmount: '2.75',
          product: {
            name: 'Burger',
            categoryId: 'c1',
            category: { id: 'c1', name: 'Food' },
          },
        },
      ],
    },
  ];

  const cancelledFixture = [
    { totalAmount: '12.34' },
    { totalAmount: '7.66' },
  ];

  const cashMovementsFixture = [
    { type: 'CASH_IN', amount: '20.00', user: null },
    { type: 'CASH_OUT', amount: '8.00', user: null },
    { type: 'CASH_IN', amount: '0.50', user: null },
  ];

  const openOrdersFixture = [
    { finalAmount: '11.11' },
    { finalAmount: '22.22' },
  ];

  beforeEach(() => {
    prisma = mockPrismaClient();
    email = { sendEmail: jest.fn().mockResolvedValue(true) };
    svc = new ZReportsService(prisma as any, email, { render: jest.fn() } as any, new ZReportAggregator());

    prisma.zReport.findFirst.mockResolvedValue(null);
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      timezone: 'UTC',
      currency: 'TRY',
    } as any);

    // order.findMany is called 3 times: paid, cancelled, open (in that
    // order). cashDrawerMovement.findMany once.
    (prisma.order.findMany as any)
      .mockResolvedValueOnce(ordersFixture as any) // paid
      .mockResolvedValueOnce(cancelledFixture as any) // cancelled
      .mockResolvedValueOnce(openOrdersFixture as any); // open
    prisma.cashDrawerMovement.findMany.mockResolvedValue(
      cashMovementsFixture as any,
    );
    prisma.zReport.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'zr-new', ...args.data }),
    );
  });

  const dto = {
    reportDate: '2026-06-01T00:00:00.000Z',
    cashDrawerOpening: 100,
    cashDrawerClosing: 150,
    notes: 'characterization',
  };

  const str = (v: any) => v?.toString?.() ?? String(v);

  it('produces exact aggregation totals in the create() payload', async () => {
    await svc.generateReport(TENANT, BRANCH, USER, dto as any);

    const data = (prisma.zReport.create as any).mock.calls[0][0].data;

    // Identity / counts
    expect(data.tenantId).toBe(TENANT);
    expect(data.branchId).toBe(BRANCH);
    expect(data.closedById).toBe(USER);
    expect(data.totalOrders).toBe(2);
    // v3 branch-scope: reportNumber now embeds a stable branch token so
    // two branches closing the SAME calendar day produce DISTINCT numbers
    // under @@unique([tenantId, branchId, reportNumber]). branchId 'b-1'
    // -> token 'B1' (hyphens stripped, first 8 chars, upper-cased).
    expect(data.reportNumber).toBe('Z-20260601-B1');

    // Sales totals (Decimal columns -> string compare)
    expect(str(data.totalSales)).toBe('130.4'); // 100.10 + 30.30
    expect(str(data.totalDiscount)).toBe('5.05'); // 5.05 + 0
    // rawNetSales = 95.05 + 30.30 = 125.35; netSales = raw - refunds(10.01)
    expect(str(data.netSales)).toBe('115.34');

    // Payment breakdown (COMPLETED only)
    expect(str(data.cashPayments)).toBe('50.05');
    expect(data.cashPaymentCount).toBe(1);
    expect(str(data.cardPayments)).toBe('45');
    expect(data.cardPaymentCount).toBe(1);
    expect(str(data.digitalPayments)).toBe('30.3');
    expect(data.digitalPaymentCount).toBe(1);

    // Refunds
    expect(str(data.totalRefunds)).toBe('10.01');
    expect(data.refundedPayments).toBe(1);
    expect(str(data.refundedAmount)).toBe('10.01');

    // Order-type breakdown
    expect(str(data.dineInSales)).toBe('95.05');
    expect(data.dineInOrders).toBe(1);
    expect(str(data.takeawaySales)).toBe('30.3');
    expect(data.takeawayOrders).toBe(1);
    expect(str(data.deliverySales)).toBe('0');
    expect(data.deliveryOrders).toBe(0);

    // Cancelled
    expect(data.cancelledOrders).toBe(2);
    expect(str(data.cancelledOrdersAmount)).toBe('20'); // 12.34 + 7.66

    // Tax: totalTax = 5.46 + 5.84 + 2.75 = 14.05
    expect(data.totalTax).toBe(14.05);
    // taxBreakdown buckets: rate 10 -> taxable = (60.06-5.46)+(30.30-2.75)
    //   = 54.60 + 27.55 = 82.15 ; tax = 5.46 + 2.75 = 8.21
    // rate 20 -> taxable = 35.04 - 5.84 = 29.20 ; tax = 5.84
    expect(data.taxBreakdown[10]).toEqual({
      taxableAmount: 82.15,
      taxAmount: 8.21,
    });
    expect(data.taxBreakdown[20]).toEqual({
      taxableAmount: 29.2,
      taxAmount: 5.84,
    });

    // Cash reconciliation
    // cashInOut = (20 + 0.50) - 8 = 12.50
    expect(str(data.cashInOut)).toBe('12.5');
    expect(str(data.openingCash)).toBe('100');
    expect(str(data.countedCash)).toBe('150');
    // expectedCash = opening(100) + cashPayments(50.05) + cashInOut(12.50)
    //   = 162.55
    expect(str(data.expectedCash)).toBe('162.55');
    // cashDifference = closing(150) - expected(162.55) = -12.55
    expect(str(data.cashDifference)).toBe('-12.55');

    // Open checks
    expect(data.openChecks).toBe(2);
    expect(str(data.openChecksAmount)).toBe('33.33'); // 11.11 + 22.22

    // Top products: aggregated by productId
    //   p1 quantity 2+3=5, revenue 60.06+30.30=90.36
    //   p2 quantity 1, revenue 35.04
    expect(data.topProducts).toEqual([
      { name: 'Burger', quantity: 5, revenue: 90.36 },
      { name: 'Cola', quantity: 1, revenue: 35.04 },
    ]);

    // Category breakdown
    //   c1 (Food): sales 60.06+30.30=90.36, qty 5
    //   c2 (Drinks): sales 35.04, qty 1
    expect(data.categoryBreakdown).toEqual([
      { categoryId: 'c1', categoryName: 'Food', sales: 90.36, quantity: 5 },
      { categoryId: 'c2', categoryName: 'Drinks', sales: 35.04, quantity: 1 },
    ]);

    // Staff performance
    //   staff-A: sales 95.05, orders 1 ; staff-B: 30.30, 1
    expect(data.staffPerformance).toEqual([
      { staffId: 'staff-A', name: 'Ann A', sales: 95.05, orders: 1, refunds: 0 },
      { staffId: 'staff-B', name: 'Bob B', sales: 30.3, orders: 1, refunds: 0 },
    ]);

    expect(data.notes).toBe('characterization');
  });

  it('throws fast-path dedupe when a report already exists for the date', async () => {
    prisma.zReport.findFirst.mockResolvedValue({ id: 'dup' } as any);
    await expect(
      svc.generateReport(TENANT, BRANCH, USER, dto as any),
    ).rejects.toThrow('Z-Report already exists for this date');
    expect(prisma.zReport.create).not.toHaveBeenCalled();
  });

  it('translates a concurrent P2002 unique violation into the business error', async () => {
    const p2002 = Object.assign(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
      {},
    );
    prisma.zReport.create.mockRejectedValue(p2002 as any);
    await expect(
      svc.generateReport(TENANT, BRANCH, USER, dto as any),
    ).rejects.toThrow('Z-Report already exists for this date');
  });

  it('rethrows non-P2002 create errors unchanged', async () => {
    const boom = new Error('db down');
    prisma.zReport.create.mockRejectedValue(boom as any);
    await expect(
      svc.generateReport(TENANT, BRANCH, USER, dto as any),
    ).rejects.toThrow('db down');
  });

  it('defaults taxRate to 10 for items with no taxRate', async () => {
    (prisma.order.findMany as any).mockReset();
    (prisma.order.findMany as any)
      .mockResolvedValueOnce([
        {
          id: 'o1',
          type: 'COUNTER',
          totalAmount: '10.00',
          discount: '0',
          finalAmount: '10.00',
          userId: null,
          user: null,
          payments: [],
          orderItems: [
            {
              productId: 'p1',
              quantity: 1,
              subtotal: '10.00',
              taxRate: null,
              taxAmount: '1.00',
              product: {
                name: 'X',
                categoryId: 'c1',
                category: null,
              },
            },
          ],
        },
      ] as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any);

    await svc.generateReport(TENANT, BRANCH, USER, dto as any);
    const data = (prisma.zReport.create as any).mock.calls[0][0].data;

    // Falls into the rate-10 bucket; taxable = 10.00 - 1.00 = 9.00
    expect(data.taxBreakdown[10]).toEqual({
      taxableAmount: 9,
      taxAmount: 1,
    });
    // null userId -> 'unknown' / 'Unknown'; null category -> 'Uncategorized'
    expect(data.staffPerformance).toEqual([
      { staffId: 'unknown', name: 'Unknown', sales: 10, orders: 1, refunds: 0 },
    ]);
    expect(data.categoryBreakdown).toEqual([
      { categoryId: 'c1', categoryName: 'Uncategorized', sales: 10, quantity: 1 },
    ]);
  });
});
