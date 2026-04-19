import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformLogDirection, PlatformLogAction } from '../constants/platform.enum';

export interface LogEntry {
  tenantId: string;
  platform: string;
  direction: string;
  action: string;
  orderId?: string;
  externalId?: string;
  request?: any;
  response?: any;
  statusCode?: number;
  success: boolean;
  error?: string;
  maxRetries?: number;
  nextRetryAt?: Date;
}

@Injectable()
export class DeliveryLogService {
  private readonly logger = new Logger(DeliveryLogService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Best-effort log write. Swallows errors so a transient DB hiccup in
   * the audit path cannot fail a successful order-create or make a
   * webhook retry loop with the platform — the caller has already done
   * the real work.
   */
  async log(entry: LogEntry) {
    try {
      return await this.prisma.deliveryPlatformLog.create({
        data: {
          tenantId: entry.tenantId,
          platform: entry.platform,
          direction: entry.direction,
          action: entry.action,
          orderId: entry.orderId,
          externalId: entry.externalId,
          request: entry.request || undefined,
          response: entry.response || undefined,
          statusCode: entry.statusCode,
          success: entry.success,
          error: entry.error,
          maxRetries: entry.maxRetries ?? 3,
          nextRetryAt: entry.nextRetryAt,
        },
      });
    } catch (error: any) {
      this.logger.warn(`Failed to create log entry: ${error.message}`);
      return null;
    }
  }

  /**
   * Strip attacker/customer-controlled PII before persisting a raw
   * webhook body. The platform's order id/token is kept for debugging;
   * personal identifiers are dropped so log-table retention doesn't
   * inadvertently turn into long-term PII storage.
   */
  scrubPii<T>(raw: T): unknown {
    if (raw == null || typeof raw !== 'object') return raw;
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (
        /phone|email|address|customer|name|buyer|recipient|gsm/i.test(key)
      ) {
        redacted[key] = '[redacted]';
      } else if (value && typeof value === 'object') {
        redacted[key] = this.scrubPii(value);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  async getFailedOperations(limit = 50) {
    return this.prisma.deliveryPlatformLog.findMany({
      where: {
        success: false,
        retryCount: { lt: 3 },
        nextRetryAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async incrementRetry(logId: string) {
    const log = await this.prisma.deliveryPlatformLog.findUnique({
      where: { id: logId },
    });
    if (!log) return;

    const nextRetryCount = log.retryCount + 1;
    const backoffMs = Math.min(60_000 * Math.pow(2, nextRetryCount), 3_600_000); // Max 1 hour

    await this.prisma.deliveryPlatformLog.update({
      where: { id: logId },
      data: {
        retryCount: nextRetryCount,
        nextRetryAt:
          nextRetryCount >= log.maxRetries
            ? null // No more retries
            : new Date(Date.now() + backoffMs),
      },
    });
  }

  async markRetrySuccess(logId: string) {
    await this.prisma.deliveryPlatformLog.update({
      where: { id: logId },
      data: { success: true, nextRetryAt: null },
    });
  }

  async getLogs(
    tenantId: string,
    filters?: {
      platform?: string;
      success?: boolean;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: any = { tenantId };
    if (filters?.platform) where.platform = filters.platform;
    if (filters?.success !== undefined) where.success = filters.success;

    const [logs, total] = await Promise.all([
      this.prisma.deliveryPlatformLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters?.limit || 50,
        skip: filters?.offset || 0,
      }),
      this.prisma.deliveryPlatformLog.count({ where }),
    ]);

    return { logs, total };
  }
}
