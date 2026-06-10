import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { DomainEventBus } from "./domain-event-bus.service";
import { OutboxService } from "./outbox.service";
import { OutboxWorkerService } from "./outbox-worker.service";
import { MarketingEventRelayService } from "./marketing-event-relay.service";

/**
 * Outbox + in-process bus ship as a @Global module so every feature can call
 * `outbox.append(...)` without importing the module everywhere. The bus is
 * the integration point that all later phases (devices, fiscal, fulfilment,
 * caller) will plug into.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    DomainEventBus,
    OutboxService,
    OutboxWorkerService,
    // Phase-5 split: HTTP relay for marketing-bound events (see service doc).
    MarketingEventRelayService,
  ],
  exports: [DomainEventBus, OutboxService],
})
export class OutboxModule {}
