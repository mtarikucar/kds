import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../../../prisma/prisma.module";
import { SubscriptionsModule } from "../../subscriptions/subscriptions.module";
import { PaytrSettlementService } from "./paytr-settlement.service";

/**
 * Standalone module wrapping the PayTR settlement service.
 *
 * `PaytrSettlementService` is consumed by both `PaymentsModule` (the
 * real-time webhook controller) and `SubscriptionsModule` (the hourly
 * inquiry-recovery sweeper). The service depends on BillingService and
 * NotificationService, both exported from SubscriptionsModule, while
 * the scheduler in SubscriptionsModule needs the settlement service —
 * a classic two-way cycle. Mirroring the `PaytrAdapterModule` pattern,
 * pulling the service into its own module + `forwardRef` lets both
 * sides resolve it cleanly.
 */
@Module({
  imports: [PrismaModule, forwardRef(() => SubscriptionsModule)],
  providers: [PaytrSettlementService],
  exports: [PaytrSettlementService],
})
export class PaytrSettlementModule {}
