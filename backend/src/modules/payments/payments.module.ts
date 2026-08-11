import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { PaytrAdapterModule } from "./adapters/paytr-adapter.module";
import { PaytrWebhookController } from "./webhooks/paytr-webhook.controller";
import { PaytrIpAllowlistGuard } from "./webhooks/paytr-ip-allowlist.guard";
import { CheckoutModule } from "../checkout/checkout.module";
import { CustomerOrdersModule } from "../customer-orders/customer-orders.module";

/**
 * What is left of payments after v3.3.0: the PayTR adapter and the webhook
 * receiver.
 *
 * The subscription rail — PaymentsService.createIntent, PaytrSettlementService
 * and the plan-centric bank-transfer flow — is gone with plans. Every payment
 * now travels the mixed-cart checkout rail (`CK-` refs), which is the only one
 * that can price a day-prorated annual line, provision an anniversary-aligned
 * period, and emit the PaymentSucceeded event the commission ledger needs.
 *
 * The webhook still dispatches TWO prefixes, and both of these imports are
 * load-bearing for that:
 *   "SP"  → CustomerSelfPayService (QR-menu customer self-pay) — unrelated to
 *           licensing and very much alive.
 *   "CK-" → CheckoutSettlementService.
 * Both are forwardRef'd because those modules import back into this one for
 * the PayTR adapter.
 */
@Module({
  imports: [
    PrismaModule,
    PaytrAdapterModule,
    forwardRef(() => CustomerOrdersModule),
    forwardRef(() => CheckoutModule),
  ],
  controllers: [PaytrWebhookController],
  providers: [PaytrIpAllowlistGuard],
  // Re-exported so consumers that imported PaymentsModule for the adapter
  // still resolve.
  exports: [PaytrAdapterModule],
})
export class PaymentsModule {}
