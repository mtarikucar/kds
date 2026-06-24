import { PaymentsFacadeService } from './payments-facade.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { MockPaymentProvider } from './adapters/mock-payment-provider';
import { PaymentProvider } from './payment-provider.interface';

/**
 * The façade is a thin dispatch over the registry. Its only live method is
 * createIntent (the mixed-cart checkout rail). We exercise the mock provider
 * to confirm the intent path + outcome metrics land where the rest of the
 * codebase expects them.
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

  it('createIntent dispatches to the named provider and emits intent_created', async () => {
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
    expect(intent.amountCents).toBe(12345);
    expect(outbox.append).toHaveBeenCalledWith(expect.objectContaining({
      type: 'payment.intent_created.v1',
    }));
  });

  it('throws for an unknown provider', async () => {
    await expect(
      facade.createIntent('does-not-exist', {
        tenantId: 't1',
        externalRef: 'sub:abc',
        idempotencyKey: 'k-unknown',
        amountCents: 100,
        currency: 'TRY',
        purpose: 'subscription',
      }),
    ).rejects.toThrow(/Unknown payment provider/);
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
