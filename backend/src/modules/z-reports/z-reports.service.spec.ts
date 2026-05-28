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
    svc = new ZReportsService(prisma as any, email);
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

    const out = await svc.generateAndSendReport('t1', 'user-1');

    expect(out.reportId).toBe('zr-existing');

    // Load-bearing: the findFirst's `where.reportDate` must equal the
    // tenant-midnight instant. If a future refactor reverts to
    // server-local midnight (e.g. `new Date(); .setHours(0,0,0,0)`),
    // this fails for any non-UTC tenant.
    const where = (prisma.zReport.findFirst as any).mock.calls[0][0].where;
    expect(where.tenantId).toBe('t1');
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

    await svc.generateAndSendReport('t1', 'user-1');

    const where = (prisma.zReport.findFirst as any).mock.calls[0][0].where;
    expect(where.reportDate.getTime()).toBe(expectedMidnight.getTime());
  });
});
