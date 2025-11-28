import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../prisma/prisma.module';

// Services
import { SubscriptionService } from './services/subscription.service';
import { StripeService } from './services/stripe.service';
import { PaytrService } from './services/paytr.service';
import { PaymentProviderFactory } from './services/payment-provider.factory';
import { BillingService } from './services/billing.service';
import { SubscriptionSchedulerService } from './services/subscription-scheduler.service';
import { NotificationService } from './services/notification.service';
import { InvoicePdfService } from './services/invoice-pdf.service';

// Controllers
import { SubscriptionController } from './controllers/subscription.controller';
import { PaymentController } from './controllers/payment.controller';
import { WebhookController } from './controllers/webhook.controller';
import { InvoiceController } from './controllers/invoice.controller';
import { StripeWebhookController } from './webhooks/stripe-webhook.controller';
import { PaytrWebhookController } from './webhooks/paytr-webhook.controller';

// Guards
import { SubscriptionGuard } from './guards/subscription.guard';
import { PlanFeatureGuard } from './guards/plan-feature.guard';

@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [
    SubscriptionController,
    PaymentController,
    InvoiceController,
    WebhookController,
    StripeWebhookController,
    PaytrWebhookController,
  ],
  providers: [
    // Services
    SubscriptionService,
    StripeService,
    PaytrService,
    PaymentProviderFactory,
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
  ],
})
export class SubscriptionsModule {}
