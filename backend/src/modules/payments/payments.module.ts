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
import { CustomerOrdersModule } from "../customer-orders/customer-orders.module";

@Module({
  imports: [
    PrismaModule,
    SubscriptionsModule,
    // ConsentService is injected into PaymentsService for the
    // checkout-time KVKK / mesafeli / iade consent gate.
    LegalModule,
    PaytrAdapterModule,
    // Settlement engine (shared with the inquiry-recovery sweeper in
    // SubscriptionsModule); pulled into its own module to break the
    // Payments ↔ Subscriptions cycle.
    PaytrSettlementModule,
    // PayTR webhook routes "SP" prefix merchantOids into
    // CustomerSelfPayService for the customer self-pay flow.
    forwardRef(() => CustomerOrdersModule),
  ],
  controllers: [PaymentsController, PaytrWebhookController],
  providers: [PaymentsService, PaytrIpAllowlistGuard],
  // Re-export so old consumers that imported PaymentsModule for the
  // adapter still resolve.
  exports: [PaytrAdapterModule],
})
export class PaymentsModule {}
