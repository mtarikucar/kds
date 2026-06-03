import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import Redis from "ioredis";
import { randomBytes } from "node:crypto";

/**
 * Cross-replica entitlement cache invalidation via Redis pub/sub.
 *
 * Why this exists:
 *   The EntitlementService keeps a small in-process cache (30s TTL) so the
 *   guard doesn't hit the DB on every request. Under multi-replica deploy,
 *   a write on Pod A would leave Pod B serving stale entitlements for up
 *   to 30 seconds — long enough to bite during an upgrade-then-immediately
 *   use-the-feature flow.
 *
 *   This bus publishes a tenantId on every local invalidate so peer
 *   replicas can drop their cache entries within milliseconds.
 *
 * Self-publish handling:
 *   Messages carry a per-process `senderId`. The subscriber compares it to
 *   its own id and ignores echoes — otherwise we'd race against the local
 *   invalidate-then-publish path. Same shape as the Socket.IO Redis adapter
 *   already used in this codebase, so the operational footprint is familiar.
 *
 * Failure mode:
 *   Redis down → publish/subscribe become no-ops. The 30s in-process TTL
 *   keeps the system eventually consistent; we just lose the millisecond
 *   propagation. Logged at warn level on connect failure, not on each
 *   message (would spam logs during Redis incidents).
 */
const CHANNEL = "hummytummy:entitlements:invalidate";

@Injectable()
export class EntitlementInvalidationBus
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(EntitlementInvalidationBus.name);
  private readonly senderId = randomBytes(8).toString("hex");
  private pub: Redis | null = null;
  private sub: Redis | null = null;
  private localHandler: ((tenantId: string) => void) | null = null;

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn(
        "REDIS_URL not set — running without cross-replica cache invalidation",
      );
      return;
    }
    try {
      this.pub = new Redis(url, {
        maxRetriesPerRequest: 3,
        // Don't crash the app if Redis is briefly unreachable; the in-process
        // cache TTL keeps correctness.
        lazyConnect: false,
      });
      // Subscriber needs a dedicated connection — Redis disallows commands
      // on a subscribed connection.
      this.sub = new Redis(url, { lazyConnect: false });
      await this.sub.subscribe(CHANNEL);
      this.sub.on("message", (_channel, msg) => this.onMessage(msg));
      this.logger.log(`subscribed to ${CHANNEL} (sender=${this.senderId})`);
    } catch (e) {
      this.logger.warn(
        `Redis connect failed; cache invalidation is local-only: ${(e as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.sub?.quit();
    } catch {
      /* ignore */
    }
    try {
      await this.pub?.quit();
    } catch {
      /* ignore */
    }
  }

  /**
   * Register the in-process callback that the bus invokes when a peer
   * publishes an invalidation. EntitlementService wires its `invalidateLocal`
   * method here at module init.
   */
  registerListener(handler: (tenantId: string) => void): void {
    this.localHandler = handler;
  }

  /**
   * Broadcast that this tenant's entitlement cache should be dropped on
   * every replica. No-op when Redis is unavailable.
   */
  async publish(tenantId: string): Promise<void> {
    if (!this.pub) return;
    try {
      await this.pub.publish(
        CHANNEL,
        JSON.stringify({ tenantId, senderId: this.senderId }),
      );
    } catch (e) {
      // Don't propagate — the local invalidate already happened; this is a
      // best-effort fan-out. Log once at the connection level rather than
      // here so a Redis outage doesn't flood the logs.
    }
  }

  private onMessage(raw: string): void {
    try {
      const parsed = JSON.parse(raw) as {
        tenantId?: string;
        senderId?: string;
      };
      if (!parsed.tenantId) return;
      // Ignore our own publishes — the local invalidate already ran.
      if (parsed.senderId === this.senderId) return;
      this.localHandler?.(parsed.tenantId);
    } catch {
      // malformed message — ignore
    }
  }
}
