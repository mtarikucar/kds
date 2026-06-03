import { Logger, Module, OnModuleInit } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { DomainEventBus } from "../outbox/domain-event-bus.service";
import { WebhookOutboundService } from "./webhook-outbound.service";
import { WebhookDeliveryWorkerService } from "./webhook-delivery-worker.service";
import { WebhooksOutboundController } from "./webhooks-outbound.controller";
// v2.8.88: WebhooksOutboundController gates on API_ACCESS via PlanFeatureGuard.
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";

/**
 * Outbound webhook module — subscriptions + delivery worker + tenant API.
 *
 * Wired to the in-process DomainEventBus on init so every domain event is
 * fanned out into the WebhookDelivery table; the worker drains that table
 * and POSTs to the tenant's URL.
 */
@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [WebhooksOutboundController],
  providers: [WebhookOutboundService, WebhookDeliveryWorkerService],
  exports: [WebhookOutboundService],
})
export class WebhooksOutboundModule implements OnModuleInit {
  private readonly logger = new Logger(WebhooksOutboundModule.name);

  constructor(
    private readonly svc: WebhookOutboundService,
    private readonly bus: DomainEventBus,
  ) {}

  onModuleInit(): void {
    // v2.8.95 — surface fanOut failures. Pre-fix
    //   .catch(() => undefined)
    // silently dropped any error here: Prisma outages, OOM, JSON
    // serialization issues, tenant-row lookups failing — all invisible
    // unless someone noticed the missing WebhookDelivery row weeks
    // later. The bus listener still cannot rethrow (other listeners
    // need to run regardless), but every failure now writes a logged
    // line tagged with the event type so on-call has a breadcrumb.
    this.bus.onAny(async (ev) => {
      await this.svc.fanOut(ev).catch((err) => {
        this.logger.error(
          `fanOut failed for event=${ev.type} tenantId=${(ev as any).tenantId ?? "n/a"}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      });
    });
  }
}
