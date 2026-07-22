import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { LegalModule } from "../legal/legal.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { PaytrWebhookController } from "./webhooks/paytr-webhook.controller";
import { PaytrIpAllowlistGuard } from "./webhooks/paytr-ip-allowlist.guard";
import { PaytrAdapterModule } from "./adapters/paytr-adapter.module";
import { PaytrSettlementModule } from "./services/paytr-settlement.module";
import { BankTransferModule } from "./services/bank-transfer.module";
import { CustomerOrdersModule } from "../customer-orders/customer-orders.module";
import { CheckoutModule } from "../checkout/checkout.module";
import { DemoGuardModule } from "../demo/demo-guard.module";

@Module({
  imports: [
    PrismaModule,
    SubscriptionsModule,
    // ConsentService is injected into PaymentsService for the
    // checkout-time KVKK / mesafeli / iade consent gate.
    LegalModule,
    PaytrAdapterModule,
    // DemoGuardService — blocks real-money initiation for the shared demo
    // tenant. Lightweight standalone module (PrismaService only); see
    // demo-guard.module.ts for why the full DemoModule/AuthModule isn't
    // imported here.
    DemoGuardModule,
    // Settlement engine (shared with the inquiry-recovery sweeper in
    // SubscriptionsModule); pulled into its own module to break the
    // Payments ↔ Subscriptions cycle.
    PaytrSettlementModule,
    // Manual bank-transfer (havale) flow — also imported by SuperadminModule
    // for the confirm/reject + settings endpoints.
    BankTransferModule,
    // PayTR webhook routes "SP" prefix merchantOids into
    // CustomerSelfPayService for the customer self-pay flow.
    forwardRef(() => CustomerOrdersModule),
    // v2.8.85: "CK-" prefix → CheckoutSettlementService for the
    // mixed-cart checkout flow.
    forwardRef(() => CheckoutModule),
  ],
  controllers: [PaymentsController, PaytrWebhookController],
  providers: [PaymentsService, PaytrIpAllowlistGuard],
  // Re-export so old consumers that imported PaymentsModule for the
  // adapter still resolve.
  exports: [PaytrAdapterModule],
})
export class PaymentsModule {}
