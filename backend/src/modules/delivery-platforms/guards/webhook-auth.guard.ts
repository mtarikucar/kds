import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual, createHmac } from 'crypto';

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
      const expectedSignature = createHmac('sha512', webhookSecret)
        .update(`${header}.${payload}`)
        .digest('base64url');

      const sigBuf = Buffer.from(signature, 'utf8');
      const expBuf = Buffer.from(expectedSignature, 'utf8');
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
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
    const webhookSecret = this.configService.get<string>(
      'TRENDYOL_WEBHOOK_SECRET',
    );

    if (!webhookSecret) {
      this.logger.error('TRENDYOL_WEBHOOK_SECRET not configured — rejecting webhook');
      throw new UnauthorizedException('Webhook secret not configured');
    }

    const signature = request.headers['x-webhook-signature'];
    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const body = request.rawBody?.toString('utf8') || JSON.stringify(request.body);
    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expectedSignature, 'utf8');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
