import { PaymentsFacadeService } from './payments-facade.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { MockPaymentProvider } from './adapters/mock-payment-provider';

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
});
