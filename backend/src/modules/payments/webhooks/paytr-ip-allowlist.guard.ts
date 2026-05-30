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
    if (!raw) {
      this.allowed = null;
      return;
    }
    const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);
    this.allowed = new Set(entries);
    // v2.8.91: startup self-test. Pre-fix a misconfigured
    // PAYTR_WEBHOOK_ALLOWED_IPS (typo, wrong format, accidental quotes)
    // silently dropped every real PayTR webhook with a 200 OK so PayTR
    // stopped retrying — invisible regression until the ops team saw
    // settlement queues backing up. Now: validate each entry looks
    // like an IPv4 or IPv6 address at boot. Invalid entries don't
    // disable the guard, but the loud warning surfaces the misconfig.
    const looksLikeIp = (s: string) =>
      /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(s) || /^[0-9a-fA-F:]+$/.test(s);
    const invalid = entries.filter((e) => !looksLikeIp(e));
    if (invalid.length > 0) {
      this.logger.error(
        `PAYTR_WEBHOOK_ALLOWED_IPS contains ${invalid.length} entries that do not look like IP addresses: [${invalid.join(', ')}]. ` +
        `Real PayTR callbacks may be silently dropped — fix the env to match the IPs published in the merchant panel.`,
      );
    }
    if (entries.length === 0) {
      this.logger.error(
        'PAYTR_WEBHOOK_ALLOWED_IPS was set but resolved to an empty list after parsing. Every webhook will be rejected.',
      );
    } else {
      this.logger.log(`PayTR webhook allowlist active with ${entries.length} entries`);
    }
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.allowed) return true; // allowlist disabled
    const req = context.switchToHttp().getRequest();
    // Trust order: prefer req.ip (Express resolves it using the
    // app-level `trust proxy` setting, so the LB-supplied XFF is
    // honoured for exactly the right number of hops) — then fall back
    // to header parsing only if Express couldn't resolve a value. The
    // earlier "XFF first, req.ip second" order let anyone bypass the
    // allowlist by setting their own X-Forwarded-For; Express's trust-
    // proxy chain is the source of truth. Cloudflare rewrites XFF
    // anyway, but defense in depth — if the front proxy ever changes
    // we don't want the guard silently weakened.
    const ip =
      req.ip ||
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      '';
    if (this.allowed.has(ip)) return true;
    // Security log — keep the full IP un-masked. This is an
    // attacker's source address (forged-webhook attempt), not a
    // customer PII data point. See the SECURITY EXCEPTION note in
    // common/helpers/pii-mask.helper.ts:maskIp.
    this.logger.warn(`Rejected PayTR webhook from non-allowlisted IP=${ip}`);
    return false;
  }
}
