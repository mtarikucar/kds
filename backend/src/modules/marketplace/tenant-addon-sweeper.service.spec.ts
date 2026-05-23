import { TenantAddOnSweeperService } from './tenant-addon-sweeper.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * Sweeper tests pin the three branches:
 *   - one-time add-ons past their period close out + emit AddOnCancelled
 *   - cancelAtPeriodEnd=true add-ons close out + emit
 *   - recurring add-ons past their period roll forward 30d
 */
describe('TenantAddOnSweeperService.runDaily', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: TenantAddOnSweeperService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('ok') };
    svc = new TenantAddOnSweeperService(prisma as any, outbox as any);
  });

  function row(over: any = {}) {
    return {
      id: 'ta-1',
      tenantId: 't1',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(Date.now() - 1000),
      addOn: { code: 'kds_extra_screen', billing: 'recurring' },
      ...over,
    };
  }

  it('closes one-time add-ons regardless of cancelAtPeriodEnd', async () => {
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([
      row({ addOn: { code: 'onsite_install', billing: 'oneTime' } }),
    ]);
    let updated: any = null;
    (prisma.tenantAddOn.update as any).mockImplementation(async ({ data }: any) => {
      updated = data;
      return { id: 'ta-1', ...data };
    });

    await svc.runOnce();

    expect(updated.status).toBe('cancelled');
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'addon.cancelled.v1' }),
    );
  });

  it('closes recurring add-ons when cancelAtPeriodEnd=true', async () => {
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([row({ cancelAtPeriodEnd: true })]);
    let updated: any = null;
    (prisma.tenantAddOn.update as any).mockImplementation(async ({ data }: any) => {
      updated = data;
      return { id: 'ta-1', ...data };
    });

    await svc.runOnce();

    expect(updated.status).toBe('cancelled');
    expect(updated.endedAt).toBeInstanceOf(Date);
  });

  it('rolls recurring add-ons forward 30 days when not cancelled', async () => {
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([row({ cancelAtPeriodEnd: false })]);
    let updated: any = null;
    (prisma.tenantAddOn.update as any).mockImplementation(async ({ data }: any) => {
      updated = data;
      return { id: 'ta-1', ...data };
    });

    await svc.runOnce();

    expect(updated.status).toBeUndefined();      // not transitioned
    expect(updated.currentPeriodStart).toBeInstanceOf(Date);
    expect(updated.currentPeriodEnd).toBeInstanceOf(Date);
    const days = (updated.currentPeriodEnd.getTime() - updated.currentPeriodStart.getTime()) / (1000 * 60 * 60 * 24);
    expect(Math.round(days)).toBe(30);
  });

  it('returns silently when nothing to sweep', async () => {
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);
    await expect(svc.runOnce()).resolves.toBeUndefined();
  });
});
