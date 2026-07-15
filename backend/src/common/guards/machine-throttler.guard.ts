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
 *  - otherwise the client IP, resolved via CF-Connecting-IP behind
 *    Cloudflare (see clientIp() — req.ip alone rotates per request behind
 *    the CF+nginx double hop, which silently disables all throttling).
 */
@Injectable()
export class MachineThrottlerGuard extends ThrottlerGuard {
  /**
   * Resolve the true client IP behind Cloudflare → nginx → app.
   *
   * `req.ip` / `req.ips` depend on Express `trust proxy`, which is set to a
   * fixed hop count (default 1). Prod sits behind TWO proxy hops (Cloudflare
   * edge + nginx), so with one trusted hop `req.ip` resolves to the nginx-
   * appended entry's predecessor — the Cloudflare EDGE ip, which ROTATES per
   * request. That silently defeats per-IP throttling entirely: every request
   * lands in a fresh bucket, so no global OR route-level limit ever
   * accumulates (this is why the reservation 3/min lookup never 429'd in
   * prod even after the default-profile fix).
   *
   * `CF-Connecting-IP` is Cloudflare's canonical true-client-IP header:
   * Cloudflare always sets it and OVERWRITES any client-supplied value, so
   * for a Cloudflare-fronted origin it is the correct, stable throttle key.
   * We prefer it when present and fall back to req.ips/req.ip for
   * dev/direct/non-Cloudflare deployments. (An attacker who bypasses
   * Cloudflare to hit the origin directly could spoof it — but the same is
   * already true of the X-Forwarded-For that req.ips trusts, so this is no
   * weaker, and strictly correct when actually behind Cloudflare. Locking
   * the origin to Cloudflare ingress is a separate infra concern.)
   */
  private clientIp(req: Record<string, any>): string {
    const cf = req?.headers?.["cf-connecting-ip"];
    if (typeof cf === "string" && cf.length > 0) return cf;
    return req?.ips?.length ? req.ips[0] : req?.ip;
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ip = this.clientIp(req);
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
