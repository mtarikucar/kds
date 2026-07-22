import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { CatalogModule } from "../catalog/catalog.module";
import { MarketplaceModule } from "../marketplace/marketplace.module";
import { OutboxModule } from "../outbox/outbox.module";
import { DeviceMeshModule } from "../device-mesh/device-mesh.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { QuoteService } from "./quote.service";
import { CheckoutService } from "./checkout.service";
import { CheckoutController } from "./checkout.controller";
import { HardwareOrdersService } from "./hardware-orders.service";
import { HardwareOrdersController } from "./hardware-orders.controller";
import { CheckoutIntentService } from "./checkout-intent.service";
import { CheckoutSettlementService } from "./checkout-settlement.service";
import { CheckoutNotificationsService } from "./checkout-notifications.service";
import { AddonPurchasabilityService } from "./addon-purchasability.service";

@Module({
  imports: [
    PrismaModule,
    CatalogModule,
    MarketplaceModule,
    OutboxModule,
    // Provisions device-mesh slots for purchased device-class hardware.
    DeviceMeshModule,
    // AddonPurchasabilityService reads EntitlementService.getForTenant.
    // EntitlementsModule is @Global() so this isn't strictly required for
    // resolution, but importing it explicitly keeps this module's own
    // dependency graph honest.
    EntitlementsModule,
  ],
  controllers: [CheckoutController, HardwareOrdersController],
  providers: [
    QuoteService,
    CheckoutService,
    HardwareOrdersService,
    // v2.8.85: mixed-cart PayTR flow.
    CheckoutIntentService,
    CheckoutSettlementService,
    // v2.8.86: order-placed email listener — subscribes on init.
    CheckoutNotificationsService,
    // Task 1 — tahsilat-önü guard: included/owned/deps-tier/redundant-limit
    // checks BEFORE createIntent ever mints a CheckoutIntent row.
    AddonPurchasabilityService,
  ],
  exports: [
    QuoteService,
    CheckoutService,
    HardwareOrdersService,
    CheckoutIntentService,
    // Exported so PaymentsModule's PaytrWebhookController can dispatch
    // CK- prefix callbacks here.
    CheckoutSettlementService,
  ],
})
export class CheckoutModule {}
