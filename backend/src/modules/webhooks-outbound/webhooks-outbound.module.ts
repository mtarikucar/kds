import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DomainEventBus } from '../outbox/domain-event-bus.service';
import { WebhookOutboundService } from './webhook-outbound.service';
import { WebhookDeliveryWorkerService } from './webhook-delivery-worker.service';
import { WebhooksOutboundController } from './webhooks-outbound.controller';

/**
 * Outbound webhook module — subscriptions + delivery worker + tenant API.
 *
 * Wired to the in-process DomainEventBus on init so every domain event is
 * fanned out into the WebhookDelivery table; the worker drains that table
 * and POSTs to the tenant's URL.
 */
@Module({
  imports: [PrismaModule],
  controllers: [WebhooksOutboundController],
  providers: [WebhookOutboundService, WebhookDeliveryWorkerService],
  exports: [WebhookOutboundService],
})
export class WebhooksOutboundModule implements OnModuleInit {
  constructor(
    private readonly svc: WebhookOutboundService,
    private readonly bus: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.bus.onAny(async (ev) => {
      await this.svc.fanOut(ev).catch(() => undefined);
    });
  }
}
