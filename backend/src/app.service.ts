import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import Redis from 'ioredis';

@Injectable()
export class AppService {
  private redis: Redis;

  constructor(private readonly prisma: PrismaService) {
    // Initialize Redis client for health checks
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // Don't retry on health checks
    });
  }

  async getHealth(): Promise<object> {
    const timestamp = new Date().toISOString();
    const checks: any = {
      status: 'ok',
      timestamp,
      service: 'Restaurant POS API',
      version: '1.0.0',
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      checks: {
        database: 'unknown',
        redis: 'unknown',
      },
    };

    // Check database connectivity
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.checks.database = 'healthy';
    } catch (error) {
      checks.checks.database = 'unhealthy';
      checks.status = 'degraded';
    }

    // Check Redis connectivity
    try {
      await this.redis.ping();
      checks.checks.redis = 'healthy';
    } catch (error) {
      checks.checks.redis = 'unhealthy';
      checks.status = 'degraded';
    }

    return checks;
  }

  async onModuleDestroy() {
    // Clean up Redis connection
    await this.redis.quit();
  }
}
