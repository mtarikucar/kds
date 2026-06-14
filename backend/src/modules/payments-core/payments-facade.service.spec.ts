import { PaymentsFacadeService } from './payments-facade.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { MockPaymentProvider } from './adapters/mock-payment-provider';
import { PaymentProvider } from './payment-provider.interface';

/**
 * The façade is a thin dispatch over the registry. We exercise the
 * mock provider end-to-end to confirm idempotency + status round-trips
 * land where the rest of the codebase expects them.
 */
describe('PaymentsFacadeService + MockPaymentProvider', () => {
  let registry: PaymentProviderRegistry;
  let outbox: { append: jest.Mock };
  let facade: PaymentsFacadeService;
  let mock: MockPaymentProvider;

  beforeEach(() => {
    registry = new PaymentProviderRegistry();
    outbox = { append: jest.fn().mockResolvedValue('outbox') };
    facade = new PaymentsFacadeService(registry, outbox as any);
    mock = new MockPaymentProvider(registry);
    // onModuleInit registers only outside production.
    process.env.NODE_ENV = 'test';
    mock.onModuleInit();
  });

  it('createIntent → status → refund round-trip', async () => {
    const intent = await facade.createIntent('mock', {
      tenantId: 't1',
      externalRef: 'sub:abc',
      idempotencyKey: 'k1',
      amountCents: 12345,
      currency: 'TRY',
      purpose: 'subscription',
    });
    expect(intent.status).toBe('succeeded');
    expect(intent.intentId).toBeTruthy();

    const status = await facade.getStatus('mock', intent.intentId);
    expect(status.amountCents).toBe(12345);
    expect(status.cardLast4).toBe('4242');

    const refund = await facade.refund(
      'mock',
      { intentId: intent.intentId, idempotencyKey: 'r1' },
      't1',
    );
    expect(refund.status).toBe('refunded');
    expect(refund.amountCents).toBe(12345);
    expect(outbox.append).toHaveBeenCalledWith(expect.objectContaining({
      type: 'payment.refund_completed.v1',
    }));
  });

  it('returns 404-style throw for unknown provider', async () => {
    await expect(facade.getStatus('does-not-exist', 'whatever')).rejects.toThrow(/Unknown payment provider/);
  });

  // ── Track 2 domain counters ────────────────────────────────────────
  describe('payment_intents_outcome_total counter', () => {
    let metrics: { incCounter: jest.Mock };

    beforeEach(() => {
      metrics = { incCounter: jest.fn() };
      // metrics is the optional last ctor arg.
      facade = new PaymentsFacadeService(registry, outbox as any, metrics as any);
    });

    it('records outcome=success on a successful createIntent', async () => {
      await facade.createIntent('mock', {
        tenantId: 't1',
        externalRef: 'sub:abc',
        idempotencyKey: 'k-success',
        amountCents: 100,
        currency: 'TRY',
        purpose: 'subscription',
      });
      expect(metrics.incCounter).toHaveBeenCalledWith(
        'payment_intents_outcome_total',
        expect.any(String),
        { outcome: 'success' },
      );
    });

    it('records outcome=failed when the provider returns a failed intent', async () => {
      // A provider whose createIntent resolves to status "failed".
      const failingProvider: PaymentProvider = {
        id: 'failing',
        modes: ['online'],
        createIntent: jest.fn().mockResolvedValue({
          providerId: 'failing',
          intentId: 'i-1',
          status: 'failed',
          amountCents: 100,
          currency: 'TRY',
        }),
        status: jest.fn(),
        refund: jest.fn(),
        parseWebhook: jest.fn(),
        healthCheck: jest.fn(),
      };
      registry.register(failingProvider);

      await facade.createIntent('failing', {
        tenantId: 't1',
        externalRef: 'sub:abc',
        idempotencyKey: 'k-failed',
        amountCents: 100,
        currency: 'TRY',
        purpose: 'subscription',
      });
      expect(metrics.incCounter).toHaveBeenCalledWith(
        'payment_intents_outcome_total',
        expect.any(String),
        { outcome: 'failed' },
      );
    });

    it('records outcome=refunded on refund', async () => {
      const intent = await facade.createIntent('mock', {
        tenantId: 't1',
        externalRef: 'sub:abc',
        idempotencyKey: 'k-ref',
        amountCents: 100,
        currency: 'TRY',
        purpose: 'subscription',
      });
      metrics.incCounter.mockClear();

      await facade.refund(
        'mock',
        { intentId: intent.intentId, idempotencyKey: 'r1' },
        't1',
      );
      expect(metrics.incCounter).toHaveBeenCalledWith(
        'payment_intents_outcome_total',
        expect.any(String),
        { outcome: 'refunded' },
      );
    });
  });

  it('does not throw when no MetricsService is injected (optional dep)', async () => {
    // facade built without metrics in the top-level beforeEach.
    const bare = new PaymentsFacadeService(registry, outbox as any);
    await expect(
      bare.createIntent('mock', {
        tenantId: 't1',
        externalRef: 'sub:abc',
        idempotencyKey: 'k-bare',
        amountCents: 100,
        currency: 'TRY',
        purpose: 'subscription',
      }),
    ).resolves.toBeDefined();
  });

  it('surfaces a swallowed outbox.append failure without breaking the operation', async () => {
    // Best-effort emit: a rejected append must NOT fail createIntent, but the
    // failure must be surfaced (captureSwallowedEmit logs at warn + Sentry).
    const warnSpy = jest
      .spyOn((facade as any).logger, 'warn')
      .mockImplementation(() => undefined);
    outbox.append.mockRejectedValueOnce(new Error('outbox down'));

    const intent = await facade.createIntent('mock', {
      tenantId: 't1',
      externalRef: 'sub:abc',
      idempotencyKey: 'k-swallow',
      amountCents: 999,
      currency: 'TRY',
      purpose: 'subscription',
    });

    // Operation still succeeds despite the emit failure.
    expect(intent.status).toBe('succeeded');
    // The swallowed emit failure was surfaced, not silently dropped.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('payments-core/intent_created'),
    );
    warnSpy.mockRestore();
  });
});
