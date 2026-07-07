import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import Redis from "ioredis";

/**
 * Redis cache for the public QR menu (MenuQueryService.getPublicMenu) — the
 * single hottest anonymous read in the system. Every table scan / menu refresh
 * re-runs a deep nested categories→products→modifiers query plus tenant, QR
 * settings and POS settings lookups; menu content changes rarely relative to
 * that read volume, so it is the textbook cache target.
 *
 * Design:
 *   - Short TTL (MENU_CACHE_TTL_SECONDS): collapses the per-scan query storm to
 *     ~one DB read per tenant per TTL window while bounding staleness — a
 *     price/availability edit is visible within the TTL even if an explicit
 *     invalidate() is never wired for that write path.
 *   - invalidate(tenantId) drops the entry immediately for known menu edits.
 *   - Best-effort + graceful: with no REDIS_URL (dev / small single-box deploy)
 *     or on any Redis error the cache silently no-ops and the caller falls back
 *     to the DB — exactly today's behaviour, never a failed request. Mirrors the
 *     degrade-only posture of EntitlementInvalidationBus / RedisIoAdapter.
 */
const KEY_PREFIX = "menu:v1:";
const MENU_CACHE_TTL_SECONDS = 30;

@Injectable()
export class MenuCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MenuCacheService.name);
  private redis: Redis | null = null;

  onModuleInit(): void {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn(
        "REDIS_URL not set — public menu cache disabled (DB read on every scan)",
      );
      return;
    }
    try {
      this.redis = new Redis(url, {
        maxRetriesPerRequest: 2,
        lazyConnect: false,
      });
      // Swallow connection errors: get/set/invalidate are all best-effort and
      // fall back to the DB. Without a handler ioredis would emit unhandled
      // 'error' events during a Redis blip.
      this.redis.on("error", () => {
        /* best-effort cache; handled per-call */
      });
    } catch (e) {
      this.logger.warn(
        `Redis connect failed; menu cache disabled: ${(e as Error).message}`,
      );
      this.redis = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis?.quit();
    } catch {
      /* ignore */
    }
  }

  private key(tenantId: string): string {
    return KEY_PREFIX + tenantId;
  }

  /** Cached tenant-level menu payload, or null on miss / no-cache / any error. */
  async getMenu<T = unknown>(tenantId: string): Promise<T | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(this.key(tenantId));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null; // best-effort: fall through to the DB
    }
  }

  /** Populate the cache with a short TTL. Never throws. */
  async setMenu(tenantId: string, payload: unknown): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        this.key(tenantId),
        JSON.stringify(payload),
        "EX",
        MENU_CACHE_TTL_SECONDS,
      );
    } catch {
      /* best-effort */
    }
  }

  /** Drop a tenant's cached menu immediately (call after a menu edit). */
  async invalidate(tenantId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.key(tenantId));
    } catch {
      /* best-effort */
    }
  }
}
