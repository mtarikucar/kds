import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { IntegrationAdapter, IntegrationKind } from '../integration-adapter.interface';
import { verifyHmacHex } from '../sig-verify';

/**
 * Trendyol Yemek delivery adapter (scaffold).
 *
 * Trendyol signs webhooks with HMAC-SHA256, hex-encoded, header
 * `trendyol-signature`. Body shape varies per event — we pass the full
 * payload through and let domain consumers parse via the centralised
 * event normaliser when it lands.
 */
@Injectable()
export class TrendyolYemekAdapter implements IntegrationAdapter {
  readonly id = 'trendyol_yemek';
  readonly kind: IntegrationKind = 'delivery';
  readonly configSchema = {
    type: 'object',
    required: ['supplierId', 'apiKey', 'apiSecret'],
    properties: {
      supplierId: { type: 'string' },
      apiKey: { type: 'string' },
      apiSecret: { type: 'string' },
      webhookSecret: { type: 'string' },
    },
  };

  private readonly logger = new Logger(TrendyolYemekAdapter.name);
  private cfg: { supplierId?: string; apiKey?: string; apiSecret?: string; webhookSecret?: string } = {};

  async init(config: any): Promise<void> {
    this.cfg = config ?? {};
  }

  async healthCheck() {
    return { ok: Boolean(this.cfg.apiKey && this.cfg.apiSecret) };
  }

  async parseWebhook(signature: string, raw: Buffer | string): Promise<unknown[]> {
    const body = typeof raw === 'string' ? raw : raw.toString('utf8');
    const secret = this.cfg.webhookSecret ?? this.cfg.apiSecret;
    if (!secret) {
      throw new Error('trendyol: webhook secret not configured');
    }
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    if (!verifyHmacHex(expected, signature)) {
      throw new Error('trendyol: invalid signature');
    }
    try {
      const parsed = JSON.parse(body);
      return [{ providerId: this.id, type: parsed?.type ?? 'order.update', payload: parsed }];
    } catch {
      return [];
    }
  }

  async syncOrderStatus(orderId: string, status: string): Promise<void> {
    this.logger.debug(`trendyol: would sync order ${orderId} → ${status}`);
  }
}
