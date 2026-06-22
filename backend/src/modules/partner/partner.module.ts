import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { CustomersModule } from "../customers/customers.module";
import { CustomerOrdersModule } from "../customer-orders/customer-orders.module";
import { MenuModule } from "../menu/menu.module";
import { PartnerApiKeyService } from "./partner-api-key.service";
import { ScreenSessionService } from "./screen-session.service";
import { PartnerKeyGuard } from "./guards/partner-key.guard";
import { ScreenScopeGuard } from "./guards/screen-scope.guard";
import { PartnerApiKeysController } from "./controllers/partner-api-keys.controller";
import { PartnerScreenSessionsController } from "./controllers/partner-screen-sessions.controller";
import { DisplayController } from "./controllers/display.controller";

/**
 * Partner Display API — third-party/remote-screen integration.
 *
 * - PartnerApiKey: tenant-issued credential (ADMIN management).
 * - ScreenSession: per-screen scoped tokens minted by a partner backend.
 * - /display surface: thin adapters reusing customer-orders / self-pay / menu.
 */
@Module({
  imports: [
    PrismaModule,
    SubscriptionsModule,
    CustomersModule,
    CustomerOrdersModule,
    MenuModule,
  ],
  controllers: [
    PartnerApiKeysController,
    PartnerScreenSessionsController,
    DisplayController,
  ],
  providers: [
    PartnerApiKeyService,
    ScreenSessionService,
    PartnerKeyGuard,
    ScreenScopeGuard,
  ],
  exports: [PartnerApiKeyService, ScreenSessionService],
})
export class PartnerModule {}
