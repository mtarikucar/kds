import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { PaytrAdapterModule } from "./adapters/paytr-adapter.module";
import { PaytrWebhookController } from "./webhooks/paytr-webhook.controller";
import { CheckoutModule } from "../checkout/checkout.module";
import { CustomersModule } from "../customers/customers.module";

/**
 * What is left of payments after v3.3.0: the PayTR adapter and the webhook
 * receiver.
 *
 * The subscription rail — PaymentsService.createIntent, PaytrSettlementService
 * and the plan-centric bank-transfer flow — is gone with plans. Every payment
 * now travels the mixed-cart checkout rail (`CK-` refs), which is the only one
 * that can price a day-prorated annual line, provision an anniversary-aligned
 * period, and emit the PaymentSucceeded event the commission ledger needs.
 */
@Module({
  imports: [
    PrismaModule,
    PaytrAdapterModule,
    forwardRef(() => CheckoutModule),
    forwardRef(() => CustomersModule),
  ],
  controllers: [PaytrWebhookController],
})
export class PaymentsModule {}
