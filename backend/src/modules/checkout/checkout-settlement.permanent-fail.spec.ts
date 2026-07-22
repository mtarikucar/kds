import { BadRequestException } from '@nestjs/common';
import { CheckoutSettlementService } from './checkout-settlement.service';

/**
 * Task 3 — deterministic provisioning failures must NOT retry forever.
 *
 * Before this fix, ANY confirmAndProvision failure (deterministic OR
 * transient) rolled CheckoutIntent.status back to 'succeeded' "for retry".
 * For a DETERMINISTIC error (e.g. the duplicate-addon BadRequestException
 * thrown by tenant-marketplace's dup guard) every retry fails identically —
 * the intent sits 'succeeded' forever: money charged, nothing delivered, no
 * refund, no alarm (DEF-2).
 *
 * Fix: classify the thrown error in the catch block.
 *   - A Nest HttpException with a 4xx status (BadRequestException,
 *     ConflictException, ForbiddenException, NotFoundException, ...) is
 *     DETERMINISTIC — retrying reproduces the exact same failure. Mark the
 *     intent 'failed_permanent' and emit an alarm-grade
 *     'SETTLEMENT_PERMANENT_FAIL' log so the superadmin recovery/refund
 *     queue can pick it up.
 *   - Anything else (raw Prisma P2034 serialization aborts, network blips,
 *     5xx) is TRANSIENT — keep today's 'succeeded' (retry) behaviour.
 * Both paths stay status-scoped (`notIn: ['provisioned', 'failed']`) so a
 * concurrent winner that already committed 'provisioned' is never clobbered.
 */
describe('CheckoutSettlementService — permanent-fail classification (Task 3)', () => {
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
      cartJson: { items: [{ type: 'addon', code: 'EXTRA_PRINTER' }] },
      amountCents: 9900,
      currency: 'TRY',
      providerId: 'paytr',
      status: 'pending',
      hardwareOrderId: null,
      addOnIds: [],
      ...overrides,
    };
  }

  function catchBlockFlips() {
    // The catch block's write is the only updateMany whose where-clause is
    // scoped with `status: { notIn: [...] }` (the mid-flight pending->
    // succeeded flip uses a plain `status: 'pending'` string match).
    return prisma.checkoutIntent.updateMany.mock.calls.filter((c: any) =>
      c[0].where.status?.notIn?.includes('provisioned'),
    );
  }

  it('(a) marks the intent failed_permanent and emits an alarm log on a deterministic BadRequestException (e.g. duplicate add-on)', async () => {
    prisma.checkoutIntent.findUnique.mockResolvedValue(intentRow());
    checkout.confirmAndProvision.mockRejectedValue(
      new BadRequestException(
        'Add-on "EXTRA_PRINTER" is already active for this tenant.',
      ),
    );
    const errorSpy = jest
      .spyOn((svc as any).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(svc.handleSuccess('CK-test-1')).rejects.toThrow(
      BadRequestException,
    );

    const flips = catchBlockFlips();
    expect(flips).toHaveLength(1);
    expect(flips[0][0].data.status).toBe('failed_permanent');
    expect(flips[0][0].where).toMatchObject({
      paymentRef: 'CK-test-1',
      status: { notIn: ['provisioned', 'failed'] },
    });

    expect(
      errorSpy.mock.calls.some((c) =>
        String(c[0]).includes('SETTLEMENT_PERMANENT_FAIL'),
      ),
    ).toBe(true);
    // Alarm must be actionable — paymentRef + tenant identify the row.
    expect(
      errorSpy.mock.calls.some(
        (c) =>
          String(c[0]).includes('CK-test-1') && String(c[0]).includes('t-1'),
      ),
    ).toBe(true);
  });

  it('(b) keeps the existing retry behaviour ("succeeded") on a transient Prisma P2034 serialization abort', async () => {
    prisma.checkoutIntent.findUnique.mockResolvedValue(intentRow());
    const serializationError: any = new Error(
      'Transaction failed due to a write conflict',
    );
    serializationError.code = 'P2034';
    checkout.confirmAndProvision.mockRejectedValue(serializationError);

    await expect(svc.handleSuccess('CK-test-1')).rejects.toBe(
      serializationError,
    );

    const flips = catchBlockFlips();
    expect(flips).toHaveLength(1);
    expect(flips[0][0].data.status).toBe('succeeded');
    expect(flips[0][0].data.status).not.toBe('failed_permanent');
  });

  it('(c) does not clobber a concurrent winner already "provisioned" — the failed_permanent write stays status-scoped', async () => {
    prisma.checkoutIntent.findUnique.mockResolvedValue(intentRow());
    checkout.confirmAndProvision.mockRejectedValue(
      new BadRequestException('duplicate add-on'),
    );
    // Simulate: another settlement pass already committed 'provisioned'
    // between our status read and the catch's write. The status-scoped
    // WHERE means Postgres's own predicate excludes that row -> count: 0.
    prisma.checkoutIntent.updateMany.mockImplementation((args: any) => {
      if (args.data.status === 'failed_permanent') {
        return Promise.resolve({ count: 0 });
      }
      return Promise.resolve({ count: 1 });
    });

    await expect(svc.handleSuccess('CK-test-1')).rejects.toThrow(
      BadRequestException,
    );

    const flips = catchBlockFlips();
    expect(flips).toHaveLength(1);
    expect(flips[0][0].data.status).toBe('failed_permanent');
    expect(flips[0][0].where.status.notIn).toEqual(
      expect.arrayContaining(['provisioned', 'failed']),
    );
    // The service must never unconditionally overwrite via the plain
    // `update` used only on the happy (provisioned) path.
    expect(prisma.checkoutIntent.update).not.toHaveBeenCalled();
  });

  it('(d) short-circuits a repeat PayTR success against an already failed_permanent intent — no re-attempt, no write', async () => {
    prisma.checkoutIntent.findUnique.mockResolvedValue(
      intentRow({ status: 'failed_permanent' }),
    );

    await svc.handleSuccess('CK-test-1');

    expect(checkout.confirmAndProvision).not.toHaveBeenCalled();
    expect(prisma.checkoutIntent.updateMany).not.toHaveBeenCalled();
    expect(prisma.checkoutIntent.update).not.toHaveBeenCalled();
  });
});
