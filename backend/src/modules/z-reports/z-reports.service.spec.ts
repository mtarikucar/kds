import { ZReportsService } from './z-reports.service';
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
    svc = new ZReportsService(prisma as any, email, { render: jest.fn() } as any);
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
    svc = new ZReportsService(prisma as any, email, { render: jest.fn() } as any);

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
});
