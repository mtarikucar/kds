import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaytrPaymentProvider } from './paytr-payment-provider';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { computeCallbackHash } from '../../payments/webhooks/paytr-hash.util';

/**
 * Iter-90 regression for the façade-side PayTR provider.
 *
 * Pre-fix, `parseWebhook` did `JSON.parse(body)` (PayTR sends
 * application/x-www-form-urlencoded, so the parse always fell to
 * `{ _raw: body }`), ignored the `signature` arg, and emitted an event
 * regardless of hash. `PaymentsFacade.ingestWebhook` is currently
 * wired to no controller, but v2.8.85 (#39) is going to plug it into the
 * mixed-cart checkout path — at which point the missing verification
 * would silently emit unverified payment events into the outbox, the
 * same blocker iter-11 closed on integration-gateway.
 *
 * Iter-90 wires verifyCallbackHash through the provider so the next
 * caller inherits verification for free.
 */
describe('PaytrPaymentProvider.parseWebhook (iter-90)', () => {
  let provider: PaytrPaymentProvider;
  let registry: PaymentProviderRegistry;
  let paytrAdapter: any;
  let config: { get: jest.Mock };

  const MERCHANT_KEY = 'test-merchant-key';
  const MERCHANT_SALT = 'test-merchant-salt';

  beforeEach(() => {
    registry = new PaymentProviderRegistry();
    paytrAdapter = {} as any;
    config = {
      get: jest.fn((key: string) => {
        if (key === 'PAYTR_MERCHANT_KEY') return MERCHANT_KEY;
        if (key === 'PAYTR_MERCHANT_SALT') return MERCHANT_SALT;
        return undefined;
      }),
    };
    provider = new PaytrPaymentProvider(registry, paytrAdapter, config as unknown as ConfigService);
  });

  function buildFormBody(fields: Record<string, string>): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) params.append(k, v);
    return params.toString();
  }

  function signedFormBody(fields: Record<string, string>): string {
    const hash = computeCallbackHash({
      merchantOid: fields.merchant_oid,
      merchantSalt: MERCHANT_SALT,
      status: fields.status,
      totalAmount: fields.total_amount,
      merchantKey: MERCHANT_KEY,
    });
    return buildFormBody({ ...fields, hash });
  }

  it('emits a payment.succeeded event for a valid success callback', async () => {
    const body = signedFormBody({
      merchant_oid: 'SUB-tenant-1-1740000000',
      status: 'success',
      total_amount: '19900',
      payment_type: 'card',
    });
    const events = await provider.parseWebhook('', body);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('payment.succeeded');
    expect(events[0].payload).toMatchObject({
      merchantOid: 'SUB-tenant-1-1740000000',
      status: 'success',
      totalAmount: '19900',
      paymentType: 'card',
    });
  });

  it('emits payment.failed for a verified failure callback', async () => {
    const body = signedFormBody({
      merchant_oid: 'SUB-tenant-1-1740000001',
      status: 'failed',
      total_amount: '19900',
    });
    const events = await provider.parseWebhook('', body);
    expect(events[0].type).toBe('payment.failed');
  });

  it('rejects a bad hash with UnauthorizedException', async () => {
    // Right merchant_oid + status + total_amount but a forged hash. Pre-iter-90
    // this would have flowed into the outbox as a "valid" success notification.
    const body = buildFormBody({
      merchant_oid: 'SUB-tenant-1-1740000002',
      status: 'success',
      total_amount: '19900',
      hash: 'forged-base64-hash==',
    });
    await expect(provider.parseWebhook('', body)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a callback whose totalAmount was tampered (hash binds amount)', async () => {
    // Sign for 19900, send 1990000 instead — verifying the hash binds the
    // amount field, not just the oid.
    const fields = {
      merchant_oid: 'SUB-tenant-1-1740000003',
      status: 'success',
      total_amount: '19900',
    };
    const hash = computeCallbackHash({
      ...fields,
      merchantOid: fields.merchant_oid,
      totalAmount: fields.total_amount,
      merchantSalt: MERCHANT_SALT,
      merchantKey: MERCHANT_KEY,
    });
    const body = buildFormBody({ ...fields, total_amount: '1990000', hash });
    await expect(provider.parseWebhook('', body)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when PAYTR_MERCHANT_KEY is missing (misconfigured deploy)', async () => {
    config.get.mockImplementation((k: string) => (k === 'PAYTR_MERCHANT_SALT' ? MERCHANT_SALT : undefined));
    const body = signedFormBody({
      merchant_oid: 'SUB-tenant-1-1740000004',
      status: 'success',
      total_amount: '19900',
    });
    await expect(provider.parseWebhook('', body)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the body is missing required fields', async () => {
    const body = buildFormBody({ merchant_oid: 'SUB-tenant-1-1740000005' });
    await expect(provider.parseWebhook('', body)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a JSON-encoded body (CI test convenience path)', async () => {
    const hash = computeCallbackHash({
      merchantOid: 'SUB-tenant-1-1740000006',
      merchantSalt: MERCHANT_SALT,
      status: 'success',
      totalAmount: '19900',
      merchantKey: MERCHANT_KEY,
    });
    const body = JSON.stringify({
      merchant_oid: 'SUB-tenant-1-1740000006',
      status: 'success',
      total_amount: '19900',
      hash,
    });
    const events = await provider.parseWebhook('', body);
    expect(events[0].type).toBe('payment.succeeded');
  });
});
