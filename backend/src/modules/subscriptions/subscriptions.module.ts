import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PublicStatsModule } from '../public-stats/public-stats.module';
import { PaytrAdapterModule } from '../payments/adapters/paytr-adapter.module';

// Services
import { SubscriptionService } from './services/subscription.service';
import { BillingService } from './services/billing.service';
import { SubscriptionSchedulerService } from './services/subscription-scheduler.service';
import { NotificationService } from './services/notification.service';
import { InvoicePdfService } from './services/invoice-pdf.service';

// Controllers
import { SubscriptionController } from './controllers/subscription.controller';
import { InvoiceController } from './controllers/invoice.controller';

// Guards
import { SubscriptionGuard } from './guards/subscription.guard';
import { PlanFeatureGuard } from './guards/plan-feature.guard';

@Module({
  imports: [
    PrismaModule,
    PublicStatsModule,
    // Needed by SchedulerService to attempt PayTR recurring charges
    // on subscription renewal. Module is intentionally separate from
    // PaymentsModule to avoid a Payments ↔ Subscriptions cycle.
    PaytrAdapterModule,
  ],
  controllers: [
    SubscriptionController,
    InvoiceController,
  ],
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
  ],
})
export class SubscriptionsModule {}
