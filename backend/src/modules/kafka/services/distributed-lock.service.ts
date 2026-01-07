import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

export interface LockOptions {
  ttlMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
}

@Injectable()
export class DistributedLockService implements OnModuleDestroy {
  private redis: Redis;
  private readonly logger = new Logger(DistributedLockService.name);
  private readonly LOCK_PREFIX = 'kafka:lock:';
  private readonly DEFAULT_TTL_MS = 30000; // 30 seconds
  private readonly DEFAULT_RETRY_COUNT = 3;
  private readonly DEFAULT_RETRY_DELAY_MS = 100;

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          return null;
        }
        return Math.min(times * 100, 3000);
      },
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis connection error', error);
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  /**
   * Acquire a distributed lock
   * @param key The lock key
   * @param options Lock options
   * @returns Lock token if acquired, null if failed
   */
  async acquireLock(key: string, options: LockOptions = {}): Promise<string | null> {
    const {
      ttlMs = this.DEFAULT_TTL_MS,
      retryCount = this.DEFAULT_RETRY_COUNT,
      retryDelayMs = this.DEFAULT_RETRY_DELAY_MS,
    } = options;

    const lockKey = `${this.LOCK_PREFIX}${key}`;
    const lockToken = randomUUID();

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        // SET key value PX ttl NX - Set only if not exists
        const result = await this.redis.set(lockKey, lockToken, 'PX', ttlMs, 'NX');

        if (result === 'OK') {
          this.logger.debug(`Lock acquired: ${key} (token: ${lockToken})`);
          return lockToken;
        }

        // Lock not acquired, wait and retry
        if (attempt < retryCount) {
          await this.sleep(retryDelayMs * (attempt + 1));
        }
      } catch (error) {
        this.logger.error(`Failed to acquire lock: ${key}`, error);
        if (attempt === retryCount) {
          return null;
        }
      }
    }

    this.logger.debug(`Failed to acquire lock after ${retryCount + 1} attempts: ${key}`);
    return null;
  }

  /**
   * Release a distributed lock
   * @param key The lock key
   * @param token The lock token (to ensure we only release our own lock)
   */
  async releaseLock(key: string, token: string): Promise<boolean> {
    const lockKey = `${this.LOCK_PREFIX}${key}`;

    // Lua script to atomically check and delete the lock
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await this.redis.eval(script, 1, lockKey, token);
      const released = result === 1;

      if (released) {
        this.logger.debug(`Lock released: ${key}`);
      } else {
        this.logger.warn(`Lock release failed (token mismatch or expired): ${key}`);
      }

      return released;
    } catch (error) {
      this.logger.error(`Failed to release lock: ${key}`, error);
      return false;
    }
  }

  /**
   * Execute a function with a distributed lock
   * @param key The lock key
   * @param fn The function to execute
   * @param options Lock options
   * @returns The result of the function, or null if lock acquisition failed
   */
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: LockOptions = {},
  ): Promise<{ result: T; acquired: true } | { result: null; acquired: false }> {
    const token = await this.acquireLock(key, options);

    if (!token) {
      this.logger.debug(`Could not acquire lock for: ${key}`);
      return { result: null, acquired: false };
    }

    try {
      const result = await fn();
      return { result, acquired: true };
    } finally {
      await this.releaseLock(key, token);
    }
  }

  /**
   * Extend the TTL of an existing lock
   * @param key The lock key
   * @param token The lock token
   * @param ttlMs New TTL in milliseconds
   */
  async extendLock(key: string, token: string, ttlMs: number): Promise<boolean> {
    const lockKey = `${this.LOCK_PREFIX}${key}`;

    // Lua script to atomically check and extend the lock
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    try {
      const result = await this.redis.eval(script, 1, lockKey, token, ttlMs);
      return result === 1;
    } catch (error) {
      this.logger.error(`Failed to extend lock: ${key}`, error);
      return false;
    }
  }

  /**
   * Check if a lock is currently held
   */
  async isLocked(key: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(`${this.LOCK_PREFIX}${key}`);
      return exists === 1;
    } catch (error) {
      this.logger.error(`Failed to check lock status: ${key}`, error);
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
