import { BadRequestException } from '@nestjs/common';
import { PosSettingsService } from './pos-settings.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * Iter-60 regressions for pos-settings update atomicity.
 *
 * Pre-fix issues:
 *
 *  1. First-time update race: findUnique → create-or-update — two
 *     concurrent first-update calls both saw null on the read and both
 *     hit the create branch, second one tripping the unique-tenantId
 *     P2002.
 *
 *  2. Self-pay cancel atomicity: pendingSelfPayment.updateMany ran
 *     OUTSIDE the settings write, so a settings update failure left
 *     intents wrongly EXPIRED while enableCustomerSelfPay was still
 *     TRUE on the DB.
 *
 * v3.0.1 update — Prisma 6 rejects findUnique/upsert on a compound
 * unique whose nullable column receives null at the client layer
 * (`tenantId_branchId: { branchId: null }`). The service now does:
 *   findFirst(tenantId, branchId=null)
 *     → existing? updateMany + findFirstOrThrow
 *     → no?       create with P2002 fallback to updateMany
 * Both writes still happen inside the same $transaction, the self-pay
 * cancel and the settings write still co-locate atomically, and the
 * concurrent first-update race is closed by the P2002 catch.
 */
describe('PosSettingsService.update (iter-60 + v3.0.1 findFirst pattern)', () => {
  let prisma: MockPrismaClient;
  let svc: PosSettingsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    // Forward $transaction work onto the prisma mock so the inner
    // writes still resolve through .table / .pendingSelfPayment.
    (prisma.$transaction as any).mockImplementation(async (work: any) => work(prisma));
    svc = new PosSettingsService(prisma as any);
  });

  it('first-update path: no findUnique/upsert; create on miss, updateMany on hit', async () => {
    // Brand-new tenant — no existing posSettings row.
    (prisma.posSettings.findFirst as any).mockResolvedValue(null);
    (prisma.posSettings.create as any).mockResolvedValue({
      tenantId: 't1',
      enableCustomerOrdering: true,
      enableTwoStepCheckout: true,
    });

    await svc.update('t1', { enableCustomerOrdering: true });

    // findUnique/upsert MUST be untouched — both reject `branchId: null` at the client layer.
    expect((prisma.posSettings.findUnique as any).mock.calls.length).toBe(0);
    expect((prisma.posSettings.upsert as any).mock.calls.length).toBe(0);
    // Create is the brand-new-tenant write.
    expect((prisma.posSettings.create as any).mock.calls.length).toBe(1);
    const createArgs = (prisma.posSettings.create as any).mock.calls[0][0];
    expect(createArgs.data.tenantId).toBe('t1');
  });

  it('first-update (create path) persists ALL provided settings, not just the 4-flag core', async () => {
    // Regression: the create branch hardcoded only enableTablelessMode /
    // TwoStepCheckout / CustomerOrdering / CustomerSelfPay, silently DROPPING
    // showProductImages / defaultMapView / requireServedForDineInPayment on a
    // tenant's first-ever settings change (the UPDATE path spread the whole dto,
    // so only brand-new tenants lost these).
    (prisma.posSettings.findFirst as any).mockResolvedValue(null);
    (prisma.posSettings.create as any).mockResolvedValue({ tenantId: 't1' });

    await svc.update('t1', {
      requireServedForDineInPayment: true,
      defaultMapView: '3d',
      showProductImages: false,
    } as any);

    const data = (prisma.posSettings.create as any).mock.calls[0][0].data;
    expect(data.requireServedForDineInPayment).toBe(true);
    expect(data.defaultMapView).toBe('3d');
    expect(data.showProductImages).toBe(false);
    // The four core flags still carry their fresh-row defaults.
    expect(data.enableTwoStepCheckout).toBe(true);
    expect(data.enableCustomerOrdering).toBe(true);
    expect(data.enableCustomerSelfPay).toBe(false);
    expect(data.enableTablelessMode).toBe(false);
  });

  it('updates run inside a single $transaction (atomicity envelope)', async () => {
    (prisma.posSettings.findFirst as any).mockResolvedValue({
      tenantId: 't1',
      enableCustomerSelfPay: true,
      enableCustomerOrdering: true,
      enableTwoStepCheckout: true,
    });
    (prisma.posSettings.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.posSettings.findFirstOrThrow as any).mockResolvedValue({ tenantId: 't1' });
    (prisma.pendingSelfPayment.updateMany as any).mockResolvedValue({ count: 0 });

    await svc.update('t1', { enableTablelessMode: true });

    // The whole thing must go through one $transaction call.
    expect((prisma.$transaction as any).mock.calls.length).toBe(1);
  });

  it('disabling self-pay cancels in-flight intents in the SAME txn as the settings write', async () => {
    (prisma.posSettings.findFirst as any).mockResolvedValue({
      tenantId: 't1',
      enableCustomerSelfPay: true,
      enableCustomerOrdering: true,
      enableTwoStepCheckout: true,
    });

    // Capture call order to assert both fire inside the txn.
    const callOrder: string[] = [];
    (prisma.pendingSelfPayment.updateMany as any).mockImplementation(async () => {
      callOrder.push('pendingSelfPayment.updateMany');
      return { count: 3 };
    });
    (prisma.posSettings.updateMany as any).mockImplementation(async () => {
      callOrder.push('posSettings.updateMany');
      return { count: 1 };
    });
    (prisma.posSettings.findFirstOrThrow as any).mockResolvedValue({ tenantId: 't1' });

    await svc.update('t1', { enableCustomerSelfPay: false });

    expect(callOrder).toEqual([
      'pendingSelfPayment.updateMany',
      'posSettings.updateMany',
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
    (prisma.posSettings.findFirst as any).mockResolvedValue({
      tenantId: 't1',
      enableCustomerSelfPay: false,
      enableCustomerOrdering: true,
      enableTwoStepCheckout: true,
    });
    (prisma.posSettings.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.posSettings.findFirstOrThrow as any).mockResolvedValue({ tenantId: 't1' });

    await svc.update('t1', { enableCustomerSelfPay: false });

    expect((prisma.pendingSelfPayment.updateMany as any).mock.calls.length).toBe(0);
  });

  it('throws BadRequestException when enableCustomerOrdering=true without two-step checkout', async () => {
    (prisma.posSettings.findFirst as any).mockResolvedValue({
      tenantId: 't1',
      enableTwoStepCheckout: false,
      enableCustomerSelfPay: false,
      enableCustomerOrdering: false,
    });

    await expect(
      svc.update('t1', { enableCustomerOrdering: true }),
    ).rejects.toThrow(BadRequestException);

    // Validation rejection must NOT leak through to a settings write.
    expect((prisma.posSettings.updateMany as any).mock.calls.length).toBe(0);
    expect((prisma.posSettings.create as any).mock.calls.length).toBe(0);
    expect((prisma.pendingSelfPayment.updateMany as any).mock.calls.length).toBe(0);
  });

  it('throws BadRequestException when disabling two-step while customer ordering stays on', async () => {
    (prisma.posSettings.findFirst as any).mockResolvedValue({
      tenantId: 't1',
      enableTwoStepCheckout: true,
      enableCustomerOrdering: true,
      enableCustomerSelfPay: false,
    });

    await expect(
      svc.update('t1', { enableTwoStepCheckout: false }),
    ).rejects.toThrow(BadRequestException);
    expect((prisma.posSettings.updateMany as any).mock.calls.length).toBe(0);
    expect((prisma.posSettings.create as any).mock.calls.length).toBe(0);
  });
});
