import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";
import Redis from "ioredis";

/**
 * Wrap a hot-path probe so a hung downstream can't stall the K8s readiness
 * tick. ioredis.ping() and prisma.$queryRaw both park on the connection's
 * command queue when the underlying socket is half-dead — without this
 * race, a Redis degradation triggers cascading pod restarts across
 * replicas (the readiness probe doesn't return within K8s' timeoutSeconds,
 * the kubelet marks the pod NotReady, the load balancer drains it, and
 * the next pod inherits the same back-pressure). 2s is generous enough
 * for cold Redis on a slow link but well under any reasonable probe
 * timeout.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(
      () => reject(new Error(`${label} timeout after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

@Injectable()
export class AppService {
  private redis: Redis;
  private static readonly HEALTH_PROBE_TIMEOUT_MS = 2000;

  constructor(private readonly prisma: PrismaService) {
    // Initialize Redis client for health checks
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // Don't retry on health checks
    });
  }

  async getHealth(): Promise<object> {
    const timestamp = new Date().toISOString();
    const checks: any = {
      status: "ok",
      timestamp,
      service: "HummyTummy API",
      version: "1.0.0",
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || "development",
      checks: {
        database: "unknown",
        redis: "unknown",
      },
    };

    // Check database connectivity
    try {
      await withTimeout(
        this.prisma.$queryRaw`SELECT 1`,
        AppService.HEALTH_PROBE_TIMEOUT_MS,
        "db",
      );
      checks.checks.database = "healthy";
    } catch (error) {
      checks.checks.database = "unhealthy";
      checks.status = "degraded";
    }

    // Check Redis connectivity
    try {
      await withTimeout(
        this.redis.ping(),
        AppService.HEALTH_PROBE_TIMEOUT_MS,
        "redis",
      );
      checks.checks.redis = "healthy";
    } catch (error) {
      checks.checks.redis = "unhealthy";
      checks.status = "degraded";
    }

    return checks;
  }

  async onModuleDestroy() {
    // Clean up Redis connection
    await this.redis.quit();
  }
}
