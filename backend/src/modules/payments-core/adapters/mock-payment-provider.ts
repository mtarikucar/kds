import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  PaymentIntent,
  PaymentIntentRequest,
  PaymentMode,
  PaymentProvider,
  PaymentTransaction,
  ProviderWebhookEvent,
  RefundRequest,
  RefundTransaction,
} from '../payment-provider.interface';
import { PaymentProviderRegistry } from '../payment-provider.registry';

/**
 * Sandbox/mock provider. Always succeeds; used by tests and the marketplace
 * super-admin "comp this order" path. Never enabled in production.
 *
 * Carries enough state (in-memory map) so a webhook replay simulates the
 * real provider lifecycle for CI tests.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider, OnModuleInit {
  readonly id = 'mock';
  readonly modes: PaymentMode[] = ['online', 'cardPresent', 'qr'];
  private readonly logger = new Logger(MockPaymentProvider.name);
  private readonly state = new Map<string, PaymentTransaction>();

  constructor(private readonly registry: PaymentProviderRegistry) {}

  onModuleInit(): void {
    // Only register the mock outside production.
    if (process.env.NODE_ENV !== 'production') {
      this.registry.register(this);
    }
  }

  async createIntent(req: PaymentIntentRequest): Promise<PaymentIntent> {
    const intentId = uuidv7();
    const tx: PaymentTransaction = {
      providerId: this.id,
      intentId,
      status: 'succeeded',
      amountCents: req.amountCents,
      currency: req.currency,
      cardBrand: 'VISA',
      cardLast4: '4242',
      authCode: 'AUTH-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      acquirerRef: 'MOCK-' + uuidv7().slice(0, 8),
    };
    this.state.set(intentId, tx);
    return {
      providerId: this.id,
      intentId,
      status: 'succeeded',
      amountCents: req.amountCents,
      currency: req.currency,
    };
  }

  async status(intentId: string): Promise<PaymentTransaction> {
    const tx = this.state.get(intentId);
    if (!tx) throw new Error(`Mock intent not found: ${intentId}`);
    return tx;
  }

  async refund(req: RefundRequest): Promise<RefundTransaction> {
    const tx = this.state.get(req.intentId);
    if (!tx) throw new Error(`Mock intent not found: ${req.intentId}`);
    const amount = req.amountCents ?? tx.amountCents;
    return {
      providerId: this.id,
      intentId: req.intentId,
      refundId: uuidv7(),
      status: 'refunded',
      amountCents: amount,
    };
  }

  async parseWebhook(_signature: string, raw: Buffer | string): Promise<ProviderWebhookEvent[]> {
    const body = typeof raw === 'string' ? raw : raw.toString('utf8');
    return [{ providerId: this.id, type: 'mock.event', payload: { body } }];
  }

  async healthCheck() {
    return { ok: true, details: { mode: 'mock' } };
  }
}
