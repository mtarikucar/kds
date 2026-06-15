import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../../../prisma/prisma.module";
import { SubscriptionsModule } from "../../subscriptions/subscriptions.module";
import { LegalModule } from "../../legal/legal.module";
import { OutboxModule } from "../../outbox/outbox.module";
import { BankTransferService } from "./bank-transfer.service";

/**
 * Manual bank-transfer (havale) subscription payments. Consumed by
 * PaymentsModule (tenant create-intent + public details) and SuperadminModule
 * (settings + pending list + confirm/reject). Mirrors PaytrSettlementModule's
 * standalone-module pattern; forwardRef on SubscriptionsModule avoids the
 * Payments ↔ Subscriptions cycle.
 */
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => SubscriptionsModule), // BillingService
    LegalModule, // ConsentService
    OutboxModule, // OutboxService
  ],
  providers: [BankTransferService],
  exports: [BankTransferService],
})
export class BankTransferModule {}
