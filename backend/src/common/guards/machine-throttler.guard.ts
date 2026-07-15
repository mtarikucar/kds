import { createHash } from "crypto";
import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Rate-limit tracker that keys machine traffic by PRINCIPAL instead of IP, so
 * a venue running many partner screens / paired devices / print bridges
 * behind one NAT IP does not collide on a single IP throttle bucket.
 *
 * Runs as the global APP_GUARD ThrottlerGuard (registered BEFORE the auth
 * chain), so req.user / req.screen are not populated yet — we must read the
 * principal id straight from the raw request headers:
 *  - `Authorization: Screen <uuidv7>.<secret>` → `screen:<uuidv7>` (the uuid
 *    prefix is stable + non-secret; we never key on the secret tail).
 *  - `Authorization: Device <token>` / `Authorization: Bridge <token>` →
 *    a sha256 prefix of the token (the raw token is entirely secret, so it
 *    is hashed before becoming a bucket key; stable per device/bridge).
 *  - `X-Partner-Key: <keyId>` → `pk:<keyId>`.
 *  - otherwise the client IP (default behavior, preserving X-Forwarded-For
 *    handling via req.ips when trust proxy is configured).
 */
@Injectable()
export class MachineThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ip = req?.ips?.length ? req.ips[0] : req?.ip;
    // SECURITY: the throttler runs BEFORE the auth guards, so the principal id
    // here is UNVERIFIED (attacker-suppliable). If we keyed on it alone, an
    // attacker could rotate a fresh fake prefix per request and escape IP
    // throttling entirely (each forged bucket is new). So the principal is a
    // SECONDARY key under the IP: a single source IP stays capped no matter
    // how many prefixes it cycles, while a genuine NAT'd venue still gets
    // per-screen granularity within its shared IP.
    const auth: string | undefined = req?.headers?.authorization;
    if (typeof auth === "string" && auth.startsWith("Screen ")) {
      const prefix = auth.slice("Screen ".length).split(".")[0];
      if (prefix) return `${ip}:screen:${prefix}`;
    }
    if (typeof auth === "string") {
      // Device fleet + print bridges poll on tight loops (heartbeat 10s,
      // next-command 5s per the agent SDK). Without a per-principal key a
      // 10-device venue exhausts the shared IP bucket and the whole fleet
      // 429s. The raw token is 100% secret — hash it before it becomes a
      // tracker key.
      const machine = auth.startsWith("Device ")
        ? ["device", auth.slice("Device ".length)]
        : auth.startsWith("Bridge ")
          ? ["bridge", auth.slice("Bridge ".length)]
          : null;
      if (machine && machine[1]) {
        const digest = createHash("sha256")
          .update(machine[1])
          .digest("hex")
          .slice(0, 16);
        return `${ip}:${machine[0]}:${digest}`;
      }
    }
    const partnerKey: string | undefined = req?.headers?.["x-partner-key"];
    if (typeof partnerKey === "string" && partnerKey.length > 0) {
      return `${ip}:pk:${partnerKey}`;
    }
    return ip;
  }
}
