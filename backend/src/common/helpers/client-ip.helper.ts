import type { Request } from 'express';

/**
 * Resolve the client IP for audit logging and rate-limit keying.
 *
 * `X-Forwarded-For` is comma-separated when traffic passes multiple proxies
 * (`client, proxy1, proxy2`). Taking the whole string fails downstream IP
 * validation, so we keep only the left-most hop. We prefer Express's
 * `req.ip` first — when `trust proxy` is configured correctly it already
 * does this and respects the trusted-hop count.
 */
export function getClientIp(req: Request): string | undefined {
  if (req.ip) return req.ip;

  const xff = req.headers['x-forwarded-for'];
  if (!xff) return undefined;

  const raw = Array.isArray(xff) ? xff[0] : xff;
  return raw?.split(',')[0]?.trim() || undefined;
}
