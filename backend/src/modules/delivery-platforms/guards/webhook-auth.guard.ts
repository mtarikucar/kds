import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class WebhookAuthGuard implements CanActivate {
  private readonly logger = new Logger(WebhookAuthGuard.name);

  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const platform = request.params.platform || request.path.split('/')[3];

    switch (platform?.toUpperCase()) {
      case 'YEMEKSEPETI':
        return this.validateYemeksepetiWebhook(request);
      case 'TRENDYOL':
        return this.validateTrendyolWebhook(request);
      default:
        this.logger.warn(`Unknown webhook platform: ${platform}`);
        throw new UnauthorizedException('Unknown webhook platform');
    }
  }

  private validateYemeksepetiWebhook(request: any): boolean {
    const authHeader = request.headers['authorization'];
    if (!authHeader) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const webhookSecret = this.configService.get<string>(
      'YEMEKSEPETI_WEBHOOK_SECRET',
    );

    if (!webhookSecret) {
      this.logger.warn('YEMEKSEPETI_WEBHOOK_SECRET not configured');
      throw new UnauthorizedException('Webhook secret not configured');
    }

    try {
      // Yemeksepeti uses HS512 JWT
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }

      const [header, payload, signature] = parts;
      const expectedSignature = crypto
        .createHmac('sha512', webhookSecret)
        .update(`${header}.${payload}`)
        .digest('base64url');

      if (signature !== expectedSignature) {
        throw new Error('Invalid signature');
      }

      // Decode payload and check expiration
      const decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      );
      if (decoded.exp && decoded.exp < Date.now() / 1000) {
        throw new Error('Token expired');
      }

      return true;
    } catch (error: any) {
      this.logger.warn(
        `Yemeksepeti webhook auth failed: ${error.message}`,
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  private validateTrendyolWebhook(request: any): boolean {
    const signature = request.headers['x-webhook-signature'];
    if (!signature) {
      // Trendyol v1 may not use signatures - allow if configured
      const webhookSecret = this.configService.get<string>(
        'TRENDYOL_WEBHOOK_SECRET',
      );
      if (!webhookSecret) {
        this.logger.warn('TRENDYOL_WEBHOOK_SECRET not configured — skipping signature validation (Trendyol v1 compatibility)');
        return true; // No secret configured = no validation required
      }
      throw new UnauthorizedException('Missing webhook signature');
    }

    const webhookSecret = this.configService.get<string>(
      'TRENDYOL_WEBHOOK_SECRET',
    );
    if (!webhookSecret) {
      this.logger.warn('TRENDYOL_WEBHOOK_SECRET not configured — skipping signature validation');
      return true;
    }

    const body = JSON.stringify(request.body);
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    if (signature !== expectedSignature) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
