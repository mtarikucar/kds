import { AttendanceService } from './attendance.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';
import { getTenantMidnight } from '../../../common/helpers/timezone.helper';

/**
 * Iter-52 regression: attendance day boundaries use tenant timezone
 * (via getTenantMidnight helper, same as z-reports iter-35), not
 * server-local midnight. For non-UTC tenants on a UTC API container,
 * clocking in at 02:00 TR (=23:00 UTC previous day) previously
 * stamped the attendance with the previous server date — which then
 * broke payroll export day boundaries and the shift-late calculation
 * against shiftTemplate.startTime.
 */
describe('AttendanceService.tenantToday (iter-52)', () => {
  let prisma: MockPrismaClient;
  let kdsGateway: any;
  let svc: AttendanceService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    kdsGateway = { emitAttendanceUpdate: jest.fn() };
    svc = new AttendanceService(prisma as any, kdsGateway);
  });

  it('clockIn looks up today using tenant timezone via getTenantMidnight', async () => {
    const TR = 'Europe/Istanbul';
    prisma.tenant.findUnique.mockResolvedValue({ timezone: TR } as any);
    prisma.attendance.findFirst.mockResolvedValue(null);
    prisma.shiftAssignment.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ primaryBranchId: 'branch-1' } as any);
    (prisma.attendance.create as any).mockResolvedValue({ id: 'a-1', branchId: 'branch-1', user: {} });

    await svc.clockIn('tenant-1', 'user-1');

    // The date attribute on the attendance.findFirst lookup should
    // equal the tenant-midnight instant, not server-local midnight.
    const lookupArgs = (prisma.attendance.findFirst as any).mock.calls[0][0];
    const expectedToday = getTenantMidnight(new Date(), TR);
    expect((lookupArgs.where.date as Date).getTime()).toBe(expectedToday.getTime());
    // v3.0.0: gateway emit takes explicit branchId as 2nd arg.
    expect(kdsGateway.emitAttendanceUpdate).toHaveBeenCalledWith(
      'tenant-1',
      'branch-1',
      expect.objectContaining({ id: 'a-1', branchId: 'branch-1' }),
    );
  });

  it('falls back to UTC when tenant.timezone is null', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ timezone: null } as any);
    prisma.attendance.findFirst.mockResolvedValue(null);
    prisma.shiftAssignment.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ primaryBranchId: 'branch-1' } as any);
    (prisma.attendance.create as any).mockResolvedValue({ id: 'a-1', branchId: 'branch-1', user: {} });

    await svc.clockIn('tenant-1', 'user-1');

    const lookupArgs = (prisma.attendance.findFirst as any).mock.calls[0][0];
    const expectedToday = getTenantMidnight(new Date(), 'UTC');
    expect((lookupArgs.where.date as Date).getTime()).toBe(expectedToday.getTime());
  });
});
