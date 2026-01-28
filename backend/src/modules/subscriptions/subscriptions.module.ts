import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../prisma/prisma.module';
import { PublicStatsModule } from '../public-stats/public-stats.module';

// Services
import { SubscriptionService } from './services/subscription.service';
import { ContactService } from './services/contact.service';
import { BillingService } from './services/billing.service';
import { SubscriptionSchedulerService } from './services/subscription-scheduler.service';
import { NotificationService } from './services/notification.service';
import { InvoicePdfService } from './services/invoice-pdf.service';

// Controllers
import { SubscriptionController } from './controllers/subscription.controller';
import { ContactController } from './controllers/contact.controller';
import { InvoiceController } from './controllers/invoice.controller';

// Guards
import { SubscriptionGuard } from './guards/subscription.guard';
import { PlanFeatureGuard } from './guards/plan-feature.guard';

@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot(),
    PublicStatsModule,
  ],
  controllers: [
    SubscriptionController,
    ContactController,
    InvoiceController,
  ],
  providers: [
    // Services
    SubscriptionService,
    ContactService,
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
