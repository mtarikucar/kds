import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  DeliverEventResponse,
  INTERNAL_EVENTS_ROUTE,
} from '../../core-contracts/internal-http.contract';
import {
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { InternalTokenGuard } from './internal-token.guard';
import { OutboxService } from '../outbox/outbox.service';

class DeliverEventDto {
  /** Versioned dotted event name, e.g. "payment.succeeded.v1". */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  type: string;

  /** The full event body (producer contract, e.g. PaymentSucceededPayload). */
  @IsObject()
  payload: Record<string, unknown>;

  /**
   * Producer's deterministic dedup key (e.g. `payment-succeeded:{paymentId}`).
   * Strongly recommended — consumers dedupe on it under redelivery.
   */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tenantId?: string;

  /** When the producer emitted the event (informational). */
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}

/**
 * Phase-5 event ingress: core delivers its outbox-drained business events
 * (today: payment.succeeded.v1) over HTTP instead of the shared in-process
 * bus. The event is appended to THIS service's outbox; OutboxWorkerService
 * then drains it onto the in-process DomainEventBus, so the existing
 * consumers (SettlementCommissionConsumer, InstallationConsumer) keep
 * working completely unchanged — same bus, same DomainEvent shape, same
 * idempotency guarantees (`sourcePaymentId` partial-unique, Serializable
 * SIGNUP guard).
 *
 * Going through the outbox (rather than dispatching directly) makes the
 * hand-off durable: a 202 response means the event is persisted, and the
 * worker's retry/backoff + DLQ semantics apply if a consumer is briefly
 * unhealthy. Delivery is at-least-once end to end — consumers already
 * dedupe, and the deterministic idempotencyKey keeps replays traceable.
 *
 * marketing.lead.converted.v1 does NOT pass through here: its producer
 * (MarketingLeadsService) and consumer (InstallationConsumer) both live in
 * this service, so it stays on the local outbox → bus path.
 *
 * `@SkipThrottle()` because every delivery arrives from core's single
 * egress IP — machine traffic, not a browser; the global 300 req/min
 * per-IP ThrottlerGuard would throttle a settlement burst into the
 * sender's retry/DLQ machinery for no reason.
 */
@Controller(INTERNAL_EVENTS_ROUTE)
@SkipThrottle()
@UseGuards(InternalTokenGuard)
export class InternalEventsController {
  constructor(private readonly outbox: OutboxService) {}

  @Post()
  @HttpCode(202)
  async deliver(@Body() dto: DeliverEventDto): Promise<DeliverEventResponse> {
    const id = await this.outbox.append({
      type: dto.type,
      payload: dto.payload,
      tenantId: dto.tenantId ?? (dto.payload?.tenantId as string) ?? null,
      idempotencyKey: dto.idempotencyKey,
    });
    return { id };
  }
}
