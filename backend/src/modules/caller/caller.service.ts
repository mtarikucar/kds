import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { NormalisedCallerEvent } from './caller-provider.interface';

/**
 * Caller / phone-order ingest. The flow:
 *
 *   provider webhook → adapter.parseWebhook() → NormalisedCallerEvent[] →
 *   caller.service.ingest() → caller_events row + outbox event →
 *   downstream consumers (UI presence channel, customer matcher) react.
 *
 * Customer matching is best-effort: an exact e164 hit links the row, but the
 * lack of a match never blocks ingestion (you still want to see the call).
 */
@Injectable()
export class CallerService {
  private readonly logger = new Logger(CallerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async ingest(tenantId: string, event: NormalisedCallerEvent) {
    // CallerEvent.tenantId has no FK in the schema (denormalised for write
    // throughput), so a malformed/unknown tenantId from the public webhook
    // route would otherwise land a noise row that the UI feed renders.
    // Validate before the create so attackers can't seed arbitrary tenants.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException('Unknown tenant');
    }

    // Try a customer match by e164. Keeps the column denormalised so the UI
    // can render "returning customer" without a join.
    let customerId: string | null = null;
    if (event.e164) {
      const c = await this.prisma.customer.findFirst({
        where: { tenantId, phone: event.e164 },
        select: { id: true },
      });
      customerId = c?.id ?? null;
    }

    const row = await this.prisma.callerEvent.create({
      data: {
        id: uuidv7(),
        tenantId,
        providerId: event.providerId,
        callId: event.callId,
        kind: event.kind,
        e164: event.e164,
        customerId,
        durationMs: event.durationMs,
        meta: event.meta as any,
        occurredAt: new Date(event.occurredAt),
      },
    });

    await this.outbox
      .append({
        type:
          event.kind === 'incoming'
            ? 'caller.incoming.v1'
            : event.kind === 'answered'
              ? 'caller.answered.v1'
              : event.kind === 'ended'
                ? 'caller.ended.v1'
                : 'caller.missed.v1',
        tenantId,
        payload: {
          callerEventId: row.id,
          providerId: event.providerId,
          callId: event.callId,
          e164: event.e164,
          customerId,
        },
      })
      .catch((e) => this.logger.warn(`caller outbox emit failed: ${(e as Error).message}`));

    return row;
  }

  listRecent(tenantId: string, limit = 50) {
    return this.prisma.callerEvent.findMany({
      where: { tenantId },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(limit, 500),
    });
  }
}
