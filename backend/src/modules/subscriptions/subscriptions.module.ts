import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { PaytrAdapterModule } from "../payments/adapters/paytr-adapter.module";
import { PaytrSettlementModule } from "../payments/services/paytr-settlement.module";

// Services
import { SubscriptionService } from "./services/subscription.service";
import { BillingService } from "./services/billing.service";
import { SubscriptionSchedulerService } from "./services/subscription-scheduler.service";
import { NotificationService } from "./services/notification.service";
import { InvoicePdfService } from "./services/invoice-pdf.service";

// Controllers
import { SubscriptionController } from "./controllers/subscription.controller";
import { InvoiceController } from "./controllers/invoice.controller";

// Guards
import { SubscriptionGuard } from "./guards/subscription.guard";
import { PlanFeatureGuard } from "./guards/plan-feature.guard";

@Module({
  imports: [
    PrismaModule,
    // Needed by SchedulerService to attempt PayTR recurring charges
    // on subscription renewal. Module is intentionally separate from
    // PaymentsModule to avoid a Payments ↔ Subscriptions cycle.
    PaytrAdapterModule,
    // PaytrSettlementService is consumed by the inquiry-recovery
    // sweeper here, and by the real-time webhook controller in
    // PaymentsModule. forwardRef breaks the cycle: settlement needs
    // Billing+Notification (exported from this module), this module
    // needs settlement.
    forwardRef(() => PaytrSettlementModule),
  ],
  controllers: [SubscriptionController, InvoiceController],
  providers: [
    // Services
    SubscriptionService,
    BillingService,
    NotificationService,
    InvoicePdfService,
    SubscriptionSchedulerService,

    // Guards
    SubscriptionGuard,
    PlanFeatureGuard,
  ],
  exports: [
    SubscriptionService,
    SubscriptionGuard,
    PlanFeatureGuard,
    BillingService,
    // Webhook controller (PaymentsModule) sends activation / payment
    // emails post-commit, so the service must be exported.
    NotificationService,
    // SuperAdmin manual-trigger endpoints (sweep-period-end,
    // send-expiry-reminders) call into the scheduler directly.
    SubscriptionSchedulerService,
  ],
})
export class SubscriptionsModule {}
