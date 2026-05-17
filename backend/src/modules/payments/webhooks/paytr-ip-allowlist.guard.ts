import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Defence-in-depth allowlist for the PayTR callback endpoint. The HMAC
 * signature is the primary authentication, so this guard never *throws*
 * — failing the allowlist returns false, and the controller responds
 * with "OK" (so PayTR stops retrying) without doing any DB work.
 *
 * Enabled only when `PAYTR_WEBHOOK_ALLOWED_IPS` is set in the env
 * (comma-separated list). In dev / staging the variable is absent and
 * every IP passes. PayTR publishes its callback IPs in their merchant
 * panel — ops should copy them into the env for production.
 */
@Injectable()
export class PaytrIpAllowlistGuard implements CanActivate {
  private readonly logger = new Logger(PaytrIpAllowlistGuard.name);
  private readonly allowed: Set<string> | null;

  constructor(private readonly config: ConfigService) {
    const raw = config.get<string>('PAYTR_WEBHOOK_ALLOWED_IPS');
    this.allowed = raw
      ? new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
      : null;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.allowed) return true; // allowlist disabled
    const req = context.switchToHttp().getRequest();
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      '';
    if (this.allowed.has(ip)) return true;
    this.logger.warn(`Rejected PayTR webhook from non-allowlisted IP=${ip}`);
    return false;
  }
}
