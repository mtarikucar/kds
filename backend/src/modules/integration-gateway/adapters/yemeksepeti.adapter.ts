import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { IntegrationAdapter, IntegrationKind } from '../integration-adapter.interface';
import { verifyHmacHex } from '../sig-verify';

/**
 * Yemeksepeti delivery adapter (scaffold).
 *
 * The live API requires a signed agreement; until that lands the adapter
 * normalises the publicly documented webhook shape and exposes the
 * IntegrationAdapter surface so other modules can reason about it. Calling
 * `syncOrderStatus` falls back to the existing delivery-platforms code path
 * (kept for backward compatibility).
 *
 * Webhook signature: HMAC-SHA256 of the raw body keyed on the shared secret,
 * hex-encoded, sent in the `x-vendor-hmac` header.
 */
@Injectable()
export class YemeksepetiAdapter implements IntegrationAdapter {
  readonly id = 'yemeksepeti';
  readonly kind: IntegrationKind = 'delivery';
  readonly configSchema = {
    type: 'object',
    required: ['apiKey', 'secret'],
    properties: {
      apiKey: { type: 'string', description: 'Yemeksepeti vendor API key' },
      secret: { type: 'string', description: 'Webhook signing secret' },
      vendorId: { type: 'string', description: 'Vendor id on Yemeksepeti' },
    },
  };

  private readonly logger = new Logger(YemeksepetiAdapter.name);
  private cfg: { apiKey?: string; secret?: string; vendorId?: string } = {};

  async init(config: any): Promise<void> {
    this.cfg = config ?? {};
  }

  async healthCheck() {
    return { ok: Boolean(this.cfg.apiKey), details: { configured: Boolean(this.cfg.apiKey) } };
  }

  async parseWebhook(signature: string, raw: Buffer | string): Promise<unknown[]> {
    const body = typeof raw === 'string' ? raw : raw.toString('utf8');
    // Empty secret used to silently accept unsigned webhooks, which is a
    // fail-open misconfig: a connection saved without a `secret` field
    // would let any unsigned POST in. Reject explicitly so the operator
    // sees the gap.
    if (!this.cfg.secret) {
      throw new Error('yemeksepeti: webhook secret not configured');
    }
    const expected = createHmac('sha256', this.cfg.secret).update(body).digest('hex');
    if (!verifyHmacHex(expected, signature)) {
      throw new Error('yemeksepeti: invalid signature');
    }
    try {
      const parsed = JSON.parse(body);
      // Normalise the Yemeksepeti shape into our generic "external order" event.
      // The full mapping into the Order entity lives in the delivery-platforms
      // module — this adapter only hands off the normalised wrapper.
      return [
        {
          providerId: this.id,
          type: parsed?.eventType ?? parsed?.status ?? 'order.update',
          payload: parsed,
        },
      ];
    } catch {
      return [];
    }
  }

  async syncOrderStatus(orderId: string, status: string): Promise<void> {
    // Real implementation POSTs to Yemeksepeti's order-status endpoint.
    // Stubbed so the integration gateway has a coherent surface today.
    this.logger.debug(`yemeksepeti: would sync order ${orderId} → ${status}`);
  }
}
