import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Rate-limit tracker that keys machine traffic by PRINCIPAL instead of IP, so
 * a venue running many partner screens behind one NAT IP does not collide on a
 * single IP throttle bucket.
 *
 * Runs as the global APP_GUARD ThrottlerGuard (registered BEFORE the auth
 * chain), so req.user / req.screen are not populated yet — we must read the
 * principal id straight from the raw request headers:
 *  - `Authorization: Screen <uuidv7>.<secret>` → `screen:<uuidv7>` (the uuid
 *    prefix is stable + non-secret; we never key on the secret tail).
 *  - `X-Partner-Key: <keyId>` → `pk:<keyId>`.
 *  - otherwise the client IP (default behavior, preserving X-Forwarded-For
 *    handling via req.ips when trust proxy is configured).
 */
@Injectable()
export class MachineThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const auth: string | undefined = req?.headers?.authorization;
    if (typeof auth === "string" && auth.startsWith("Screen ")) {
      const token = auth.slice("Screen ".length);
      const prefix = token.split(".")[0];
      if (prefix) return `screen:${prefix}`;
    }
    const partnerKey: string | undefined = req?.headers?.["x-partner-key"];
    if (typeof partnerKey === "string" && partnerKey.length > 0) {
      return `pk:${partnerKey}`;
    }
    return req?.ips?.length ? req.ips[0] : req?.ip;
  }
}
