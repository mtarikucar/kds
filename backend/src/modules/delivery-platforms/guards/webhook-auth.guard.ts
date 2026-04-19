import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual, createHmac } from 'crypto';

/**
 * Mark a webhook handler with the platform it serves. The guard reads
 * this metadata rather than parsing the URL, so an admin misroute or
 * global-prefix change can't silently break signature verification.
 */
export const WEBHOOK_PLATFORM_KEY = 'webhookPlatform';
export const WebhookPlatform = (platform: string) =>
  SetMetadata(WEBHOOK_PLATFORM_KEY, platform.toUpperCase());

/** Trendyol only: reject signed bodies older than this many seconds. */
const WEBHOOK_MAX_AGE_SECONDS = 300;

@Injectable()
export class WebhookAuthGuard implements CanActivate {
  private readonly logger = new Logger(WebhookAuthGuard.name);

  constructor(
    private configService: ConfigService,
    private reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const platform = this.reflector.getAllAndOverride<string>(
      WEBHOOK_PLATFORM_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!platform) {
      // Fail-closed: a webhook handler without metadata is a bug.
      throw new UnauthorizedException('Webhook platform not declared');
    }
    const request = context.switchToHttp().getRequest();
    switch (platform) {
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

      const decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      );
      // Defensive: `exp` must be a number, and the token must be fresh.
      if (typeof decoded.exp !== 'number' || decoded.exp < Date.now() / 1000) {
        throw new Error('Token expired or malformed');
      }

      return true;
    } catch (error: any) {
      this.logger.warn(`Yemeksepeti webhook auth failed: ${error.message}`);
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

    // Require + enforce a timestamp header so replayed signatures
    // become useless after the window lapses.
    const timestamp = request.headers['x-webhook-timestamp'];
    if (timestamp) {
      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > WEBHOOK_MAX_AGE_SECONDS) {
        throw new UnauthorizedException('Stale webhook timestamp');
      }
    }

    const body = request.rawBody?.toString('utf8') || JSON.stringify(request.body);
    const signedPayload = timestamp ? `${timestamp}.${body}` : body;
    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(signedPayload)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expectedSignature, 'utf8');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
