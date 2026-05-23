import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { IntegrationAdapter, IntegrationKind } from '../integration-adapter.interface';
import { verifyHmacHex } from '../sig-verify';

/**
 * Getir Yemek delivery adapter (scaffold). Same shape as Yemeksepeti — kept
 * in a separate file so the brand-specific signing and rate-limit profile
 * can diverge as the live integration matures.
 */
@Injectable()
export class GetirAdapter implements IntegrationAdapter {
  readonly id = 'getir';
  readonly kind: IntegrationKind = 'delivery';
  readonly configSchema = {
    type: 'object',
    required: ['vendorToken', 'webhookSecret'],
    properties: {
      vendorToken: { type: 'string' },
      webhookSecret: { type: 'string' },
      restaurantId: { type: 'string' },
    },
  };

  private readonly logger = new Logger(GetirAdapter.name);
  private cfg: { vendorToken?: string; webhookSecret?: string; restaurantId?: string } = {};

  async init(config: any): Promise<void> {
    this.cfg = config ?? {};
  }

  async healthCheck() {
    return { ok: Boolean(this.cfg.vendorToken) };
  }

  async parseWebhook(signature: string, raw: Buffer | string): Promise<unknown[]> {
    const body = typeof raw === 'string' ? raw : raw.toString('utf8');
    if (this.cfg.webhookSecret) {
      const expected = createHmac('sha256', this.cfg.webhookSecret).update(body).digest('hex');
      if (!verifyHmacHex(expected, signature)) {
        throw new Error('getir: invalid signature');
      }
    }
    try {
      const parsed = JSON.parse(body);
      return [{ providerId: this.id, type: parsed?.eventName ?? 'order.update', payload: parsed }];
    } catch {
      return [];
    }
  }

  async syncOrderStatus(orderId: string, status: string): Promise<void> {
    this.logger.debug(`getir: would sync order ${orderId} → ${status}`);
  }
}
