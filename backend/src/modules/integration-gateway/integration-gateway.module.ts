import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { IntegrationService } from "./integration.service";
import { IntegrationController } from "./integration.controller";
import { YemeksepetiAdapter } from "./adapters/yemeksepeti.adapter";
import { GetirAdapter } from "./adapters/getir.adapter";
import { TrendyolYemekAdapter } from "./adapters/trendyol-yemek.adapter";

/**
 * Integration gateway module. The scaffold adapters below are registered as
 * plain providers so they can be DI-resolved + unit-tested; the catalog of
 * IntegrationProviderDef rows in the DB names them by id. They are used only
 * for webhook HMAC signature verification (IntegrationService.adapters).
 *
 * SCAFFOLD ONLY — NOT a connectable product surface. There is no order/event
 * pipeline behind these adapters: ingestWebhook verifies a signature and then
 * honestly rejects (it does not persist or forward). Accordingly every
 * IntegrationProviderDef row is seeded `coming_soon` (non-connectable) in
 * prisma/seeds/seed-marketplace.ts, so GET /providers shows nothing
 * connectable and connect() refuses.
 *
 * NOTE: the real delivery order flow (order ingest, kitchen ticket print,
 * status push, polling, reconciliation) lives in the delivery-platforms
 * module — the yemeksepeti/getir/trendyol_yemek adapters here DUPLICATE it.
 * Real payment webhooks (PayTR) live in the payments module.
 */
@Module({
  imports: [PrismaModule],
  controllers: [IntegrationController],
  providers: [
    IntegrationService,
    YemeksepetiAdapter,
    GetirAdapter,
    TrendyolYemekAdapter,
  ],
  exports: [
    IntegrationService,
    YemeksepetiAdapter,
    GetirAdapter,
    TrendyolYemekAdapter,
  ],
})
export class IntegrationGatewayModule {}
