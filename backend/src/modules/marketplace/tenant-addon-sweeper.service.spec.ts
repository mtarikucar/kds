import { TenantAddOnSweeperService } from './tenant-addon-sweeper.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import { EventTypes } from '../outbox/event-types';
import { ADDON_GRACE_DAYS } from './marketplace.types';

/**
 * Sweeper tests pin the manual-renewal lifecycle (no PayTR card vault, so we
 * never auto-charge — recurring add-ons mirror the Subscription lifecycle):
 *   - one-time add-ons past their period close out (cancelled) + emit cancel
 *   - cancelAtPeriodEnd=true add-ons close out (cancelled) + emit cancel
 *   - recurring active add-ons past their period transition to PAST_DUE
 *     (NOT a free +30d extension — that was the defect) + emit AddOnPastDue
 *   - recurring PAST_DUE add-ons WITHIN grace are left alone (grant kept live)
 *   - recurring PAST_DUE add-ons PAST grace expire + emit AddOnCancelled
 *     (projector revokes the grant)
 */
describe('TenantAddOnSweeperService.runOnce', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let notifications: { sendAddOnPastDue: jest.Mock };
  let svc: TenantAddOnSweeperService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('ok') };
    notifications = { sendAddOnPastDue: jest.fn().mockResolvedValue(true) };
    svc = new TenantAddOnSweeperService(prisma as any, outbox as any, notifications as any);
    // notifyOperator looks up tenant + admin
    (prisma.tenant.findUnique as any).mockResolvedValue({ name: 'Acme' });
    (prisma.user.findFirst as any).mockResolvedValue({ email: 'admin@acme.test' });
    (prisma.tenantAddOn.updateMany as any).mockResolvedValue({ count: 1 });
  });

  const DAY = 24 * 60 * 60 * 1000;

  function row(over: any = {}) {
    return {
      id: 'ta-1',
      tenantId: 't1',
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(Date.now() - 1000),
      addOn: { code: 'kds_extra_screen', billing: 'recurring' },
      ...over,
    };
  }

  it('closes one-time add-ons (cancelled + emit AddOnCancelled)', async () => {
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
    expect(updated.endedAt).toBeInstanceOf(Date);
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: EventTypes.AddOnCancelled }),
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
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: EventTypes.AddOnCancelled }),
    );
  });

  it('transitions an active recurring add-on to PAST_DUE at period end — NOT a free +30d extension', async () => {
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([row({ cancelAtPeriodEnd: false })]);

    await svc.runOnce();

    // The defect was a free period roll-forward via tenantAddOn.update.
    expect((prisma.tenantAddOn.update as any).mock.calls.length).toBe(0);
    // The fix flips status → past_due via a status-gated claim.
    const claim = (prisma.tenantAddOn.updateMany as any).mock.calls[0][0];
    expect(claim.where).toEqual({ id: 'ta-1', status: 'active' });
    expect(claim.data).toEqual({ status: 'past_due' });
    // Operator is nudged + the projector signal is emitted.
    const ev = outbox.append.mock.calls.find((c) => c[0]?.type === EventTypes.AddOnPastDue);
    expect(ev).toBeDefined();
    expect(typeof ev[0].payload.graceEndsAt).toBe('string');
    expect(notifications.sendAddOnPastDue).toHaveBeenCalledWith(
      'admin@acme.test',
      'Acme',
      'kds_extra_screen',
      'past_due',
    );
  });

  it('leaves a PAST_DUE add-on still WITHIN its grace window untouched (grant kept live)', async () => {
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([
      row({
        status: 'past_due',
        // period ended just now → grace not yet elapsed
        currentPeriodEnd: new Date(Date.now() - 1000),
      }),
    ]);

    await svc.runOnce();

    expect((prisma.tenantAddOn.updateMany as any).mock.calls.length).toBe(0);
    expect((prisma.tenantAddOn.update as any).mock.calls.length).toBe(0);
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('expires a PAST_DUE add-on past its grace window + emits AddOnCancelled (revoke)', async () => {
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([
      row({
        status: 'past_due',
        // period ended (grace + 1) days ago → grace has elapsed
        currentPeriodEnd: new Date(Date.now() - (ADDON_GRACE_DAYS + 1) * DAY),
      }),
    ]);

    await svc.runOnce();

    const claim = (prisma.tenantAddOn.updateMany as any).mock.calls[0][0];
    expect(claim.where).toEqual({ id: 'ta-1', status: 'past_due' });
    expect(claim.data.status).toBe('expired');
    expect(claim.data.endedAt).toBeInstanceOf(Date);
    const ev = outbox.append.mock.calls.find((c) => c[0]?.type === EventTypes.AddOnCancelled);
    expect(ev).toBeDefined();
    expect(notifications.sendAddOnPastDue).toHaveBeenCalledWith(
      'admin@acme.test',
      'Acme',
      'kds_extra_screen',
      'expired',
    );
  });

  it('past_due claim losing the race (count 0) does not emit', async () => {
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([
      row({
        status: 'past_due',
        currentPeriodEnd: new Date(Date.now() - (ADDON_GRACE_DAYS + 1) * DAY),
      }),
    ]);
    (prisma.tenantAddOn.updateMany as any).mockResolvedValue({ count: 0 });

    await svc.runOnce();

    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('returns silently when nothing to sweep', async () => {
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);
    await expect(svc.runOnce()).resolves.toBeUndefined();
  });

  it('works without a NotificationService injected (best-effort email is optional)', async () => {
    svc = new TenantAddOnSweeperService(prisma as any, outbox as any);
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([row({ cancelAtPeriodEnd: false })]);
    await expect(svc.runOnce()).resolves.toBeUndefined();
    const ev = outbox.append.mock.calls.find((c) => c[0]?.type === EventTypes.AddOnPastDue);
    expect(ev).toBeDefined();
  });
});
