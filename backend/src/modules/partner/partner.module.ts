import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { CustomersModule } from "../customers/customers.module";
import { PartnerApiKeyService } from "./partner-api-key.service";
import { ScreenSessionService } from "./screen-session.service";
import { PartnerKeyGuard } from "./guards/partner-key.guard";
import { PartnerApiKeysController } from "./controllers/partner-api-keys.controller";
import { PartnerScreenSessionsController } from "./controllers/partner-screen-sessions.controller";

/**
 * Partner Display API — third-party/remote-screen integration.
 *
 * - PartnerApiKey: tenant-issued credential (ADMIN management).
 * - ScreenSession: per-screen scoped tokens minted by a partner backend.
 * - (Phase 5) /display surface reusing customer-orders / self-pay / menu.
 */
@Module({
  imports: [PrismaModule, SubscriptionsModule, CustomersModule],
  controllers: [PartnerApiKeysController, PartnerScreenSessionsController],
  providers: [PartnerApiKeyService, ScreenSessionService, PartnerKeyGuard],
  exports: [PartnerApiKeyService, ScreenSessionService],
})
export class PartnerModule {}
