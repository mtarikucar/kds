import { CheckoutSettlementService } from './checkout-settlement.service';

/**
 * v2.8.85 — CheckoutSettlementService.
 *
 * The settlement service is the webhook-side counterpart to
 * CheckoutIntentService. Idempotency is the design centre: PayTR retries
 * each callback up to 4× even after a 200 OK if the response body isn't
 * literally "OK" / "FAIL", and the controller side returns "OK" on every
 * branch — so the service itself MUST refuse to double-provision.
 *
 * Lifecycle invariants under test:
 *   pending → succeeded → provisioned  (happy path)
 *   pending → failed                   (PayTR returned failure)
 *   succeeded → succeeded              (idempotent re-arrival)
 *   provisioned → provisioned          (idempotent re-arrival)
 *   provisioned + late failure         → log + bail; DON'T roll back
 *   failed + late success              → log + bail; DON'T provision
 */
describe('CheckoutSettlementService (v2.8.85)', () => {
  let prisma: any;
  let checkout: any;
  let svc: CheckoutSettlementService;

  beforeEach(() => {
    prisma = {
      checkoutIntent: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    checkout = {
      confirmAndProvision: jest.fn(),
    };
    svc = new CheckoutSettlementService(prisma, checkout);
  });

  function intentRow(overrides: any = {}) {
    return {
      id: 'ci-1',
      tenantId: 't-1',
      paymentRef: 'CK-test-1',
      cartJson: { items: [{ type: 'plan', code: 'PRO' }] },
      amountCents: 19900,
      currency: 'TRY',
      providerId: 'paytr',
      status: 'pending',
      hardwareOrderId: null,
      addOnIds: [],
      ...overrides,
    };
  }

  describe('handleSuccess', () => {
    it('provisions and flips status to "provisioned" on the happy path', async () => {
      prisma.checkoutIntent.findUnique.mockResolvedValue(intentRow());
      checkout.confirmAndProvision.mockResolvedValue({
        quote: { lines: [], totalCents: 19900, currency: 'TRY' },
        hardwareOrderId: 'hw-1',
        addOnIds: ['ad-1', 'ad-2'],
      });

      await svc.handleSuccess('CK-test-1', 'card');

      // Mid-flight flip to 'succeeded' before provisioning, then final
      // update to 'provisioned'.
      const flipCall = prisma.checkoutIntent.updateMany.mock.calls[0][0];
      expect(flipCall.where).toMatchObject({ paymentRef: 'CK-test-1', status: 'pending' });
      expect(flipCall.data.status).toBe('succeeded');

      expect(checkout.confirmAndProvision).toHaveBeenCalledWith(
        't-1',
        { items: [{ type: 'plan', code: 'PRO' }] },
        'CK-test-1',
      );

      const finalCall = prisma.checkoutIntent.update.mock.calls[0][0];
      expect(finalCall.where).toEqual({ paymentRef: 'CK-test-1' });
      expect(finalCall.data).toMatchObject({
        status: 'provisioned',
        hardwareOrderId: 'hw-1',
        addOnIds: ['ad-1', 'ad-2'],
      });
    });

    it('is idempotent when called again on an already-provisioned intent (PayTR retry storm safe)', async () => {
      prisma.checkoutIntent.findUnique.mockResolvedValue(intentRow({ status: 'provisioned' }));
      await svc.handleSuccess('CK-test-1');
      expect(checkout.confirmAndProvision).not.toHaveBeenCalled();
      expect(prisma.checkoutIntent.updateMany).not.toHaveBeenCalled();
      expect(prisma.checkoutIntent.update).not.toHaveBeenCalled();
    });

    it('refuses to provision when intent is already "failed" (late success is suspicious — paper trail before money moves)', async () => {
      prisma.checkoutIntent.findUnique.mockResolvedValue(intentRow({ status: 'failed' }));
      await svc.handleSuccess('CK-test-1');
      expect(checkout.confirmAndProvision).not.toHaveBeenCalled();
    });

    it('logs and bails for an unknown paymentRef (don\'t leak which OIDs exist)', async () => {
      prisma.checkoutIntent.findUnique.mockResolvedValue(null);
      await svc.handleSuccess('CK-bogus');
      expect(checkout.confirmAndProvision).not.toHaveBeenCalled();
    });

    it('rolls the status flip back to "succeeded" when provisioning throws so a retry can recover', async () => {
      prisma.checkoutIntent.findUnique.mockResolvedValue(intentRow());
      checkout.confirmAndProvision.mockRejectedValue(new Error('stock allocation failed'));

      await expect(svc.handleSuccess('CK-test-1')).rejects.toThrow(
        'stock allocation failed',
      );

      // The error path issues a status flip back to 'succeeded' so the
      // recovery sweep / manual retry can re-attempt the provisioning
      // without losing the fact that PayTR did charge the card.
      const rollback = prisma.checkoutIntent.update.mock.calls.find(
        (c: any) => c[0].data.status === 'succeeded',
      );
      expect(rollback).toBeDefined();
    });
  });

  describe('handleFailure', () => {
    it('flips status to "failed" and persists the reason (truncated) on a fresh failure', async () => {
      prisma.checkoutIntent.findUnique.mockResolvedValue(intentRow());
      await svc.handleFailure('CK-test-1', 'card_declined');
      const call = prisma.checkoutIntent.updateMany.mock.calls[0][0];
      expect(call.where).toMatchObject({
        paymentRef: 'CK-test-1',
        status: { in: ['pending', 'succeeded'] },
      });
      expect(call.data).toMatchObject({
        status: 'failed',
        failureReason: 'card_declined',
      });
    });

    it('truncates an oversize failure reason at 500 chars (vendors sometimes return multi-kilobyte HTML)', async () => {
      prisma.checkoutIntent.findUnique.mockResolvedValue(intentRow());
      const huge = 'x'.repeat(5000);
      await svc.handleFailure('CK-test-1', huge);
      const call = prisma.checkoutIntent.updateMany.mock.calls[0][0];
      expect(call.data.failureReason).toHaveLength(500);
    });

    it('does NOT roll back a provisioned intent on a late failure callback (the buyer already got the goods)', async () => {
      prisma.checkoutIntent.findUnique.mockResolvedValue({ status: 'provisioned' });
      await svc.handleFailure('CK-test-1', 'some failure');
      expect(prisma.checkoutIntent.updateMany).not.toHaveBeenCalled();
    });

    it('logs and bails for an unknown paymentRef', async () => {
      prisma.checkoutIntent.findUnique.mockResolvedValue(null);
      await svc.handleFailure('CK-bogus', 'whatever');
      expect(prisma.checkoutIntent.updateMany).not.toHaveBeenCalled();
    });
  });
});
