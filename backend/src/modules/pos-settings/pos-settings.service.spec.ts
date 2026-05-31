import { BadRequestException } from '@nestjs/common';
import { PosSettingsService } from './pos-settings.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * Iter-60 regressions for pos-settings update atomicity.
 *
 * Two pre-fix issues:
 *
 *  1. First-time update race: findUnique → create-or-update — two
 *     concurrent first-update calls both saw null on the read and both
 *     hit the create branch, second one tripping the unique-tenantId
 *     P2002. iter-60 collapses to a single upsert inside the txn.
 *
 *  2. Self-pay cancel atomicity: pendingSelfPayment.updateMany ran
 *     OUTSIDE the settings write, so a settings update failure left
 *     intents wrongly EXPIRED while enableCustomerSelfPay was still
 *     TRUE on the DB. iter-60 wraps both writes in one $transaction.
 */
describe('PosSettingsService.update (iter-60)', () => {
  let prisma: MockPrismaClient;
  let svc: PosSettingsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    // Forward $transaction work onto the prisma mock so the inner
    // writes still resolve through .table / .pendingSelfPayment.
    (prisma.$transaction as any).mockImplementation(async (work: any) => work(prisma));
    svc = new PosSettingsService(prisma as any);
  });

  it('uses upsert (not findUnique → create) so concurrent first-updates do not P2002', async () => {
    // Simulate a brand-new tenant — no existing posSettings row.
    prisma.posSettings.findUnique.mockResolvedValue(null);
    (prisma.posSettings.upsert as any).mockResolvedValue({
      tenantId: 't1',
      enableCustomerOrdering: true,
      enableTwoStepCheckout: true,
    });

    await svc.update('t1', { enableCustomerOrdering: true });

    // The legacy code path called .create() — that's the race vector
    // and must not be the write surface any more.
    expect((prisma.posSettings.create as any).mock.calls.length).toBe(0);
    expect((prisma.posSettings.upsert as any).mock.calls.length).toBe(1);
    const upsertArgs = (prisma.posSettings.upsert as any).mock.calls[0][0];
    // v3.0.0 — settings tables now key on compound (tenantId,
    // branchId). The tenant-default row is branchId=null.
    expect(upsertArgs.where).toEqual({
      tenantId_branchId: { tenantId: 't1', branchId: null },
    });
  });

  it('updates run inside a single $transaction (atomicity envelope)', async () => {
    prisma.posSettings.findUnique.mockResolvedValue({
      tenantId: 't1',
      enableCustomerSelfPay: true,
      enableCustomerOrdering: true,
      enableTwoStepCheckout: true,
    } as any);
    (prisma.posSettings.upsert as any).mockResolvedValue({ tenantId: 't1' });
    (prisma.pendingSelfPayment.updateMany as any).mockResolvedValue({ count: 0 });

    await svc.update('t1', { enableTablelessMode: true });

    // The whole thing must go through one $transaction call.
    expect((prisma.$transaction as any).mock.calls.length).toBe(1);
  });

  it('disabling self-pay cancels in-flight intents in the SAME txn as the settings upsert', async () => {
    prisma.posSettings.findUnique.mockResolvedValue({
      tenantId: 't1',
      enableCustomerSelfPay: true,
      enableCustomerOrdering: true,
      enableTwoStepCheckout: true,
    } as any);

    // Capture call order to assert both fire inside the txn.
    const callOrder: string[] = [];
    (prisma.pendingSelfPayment.updateMany as any).mockImplementation(async () => {
      callOrder.push('pendingSelfPayment.updateMany');
      return { count: 3 };
    });
    (prisma.posSettings.upsert as any).mockImplementation(async () => {
      callOrder.push('posSettings.upsert');
      return { tenantId: 't1' };
    });

    await svc.update('t1', { enableCustomerSelfPay: false });

    expect(callOrder).toEqual([
      'pendingSelfPayment.updateMany',
      'posSettings.upsert',
    ]);

    // The cancel WHERE must scope by tenantId AND status=PENDING — a
    // wider WHERE would clobber unrelated rows.
    const cancelArgs = (prisma.pendingSelfPayment.updateMany as any).mock.calls[0][0];
    expect(cancelArgs.where).toEqual({ tenantId: 't1', status: 'PENDING' });
    expect(cancelArgs.data).toEqual({
      status: 'EXPIRED',
      failureReason: 'tenant_disabled_self_pay',
    });
  });

  it('does NOT cancel intents when self-pay was already disabled', async () => {
    prisma.posSettings.findUnique.mockResolvedValue({
      tenantId: 't1',
      enableCustomerSelfPay: false,
      enableCustomerOrdering: true,
      enableTwoStepCheckout: true,
    } as any);
    (prisma.posSettings.upsert as any).mockResolvedValue({ tenantId: 't1' });

    await svc.update('t1', { enableCustomerSelfPay: false });

    expect((prisma.pendingSelfPayment.updateMany as any).mock.calls.length).toBe(0);
  });

  it('throws BadRequestException when enableCustomerOrdering=true without two-step checkout', async () => {
    prisma.posSettings.findUnique.mockResolvedValue({
      tenantId: 't1',
      enableTwoStepCheckout: false,
      enableCustomerSelfPay: false,
      enableCustomerOrdering: false,
    } as any);

    await expect(
      svc.update('t1', { enableCustomerOrdering: true }),
    ).rejects.toThrow(BadRequestException);

    // Validation rejection must NOT leak through to a settings write.
    expect((prisma.posSettings.upsert as any).mock.calls.length).toBe(0);
    expect((prisma.pendingSelfPayment.updateMany as any).mock.calls.length).toBe(0);
  });

  it('throws BadRequestException when disabling two-step while customer ordering stays on', async () => {
    prisma.posSettings.findUnique.mockResolvedValue({
      tenantId: 't1',
      enableTwoStepCheckout: true,
      enableCustomerOrdering: true,
      enableCustomerSelfPay: false,
    } as any);

    await expect(
      svc.update('t1', { enableTwoStepCheckout: false }),
    ).rejects.toThrow(BadRequestException);
    expect((prisma.posSettings.upsert as any).mock.calls.length).toBe(0);
  });
});
