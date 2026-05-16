import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaytrWebhookController } from './webhooks/paytr-webhook.controller';
import { PaytrIpAllowlistGuard } from './webhooks/paytr-ip-allowlist.guard';
import { PaytrAdapterModule } from './adapters/paytr-adapter.module';
import { CustomerOrdersModule } from '../customer-orders/customer-orders.module';

@Module({
  imports: [
    PrismaModule,
    SubscriptionsModule,
    PaytrAdapterModule,
    // PayTR webhook routes "SP" prefix merchantOids into
    // CustomerSelfPayService for the customer self-pay flow.
    forwardRef(() => CustomerOrdersModule),
  ],
  controllers: [PaymentsController, PaytrWebhookController],
  providers: [PaymentsService, PaytrIpAllowlistGuard],
  // Re-export so old consumers that imported PaymentsModule for the
  // adapter still resolve (none currently, but the module surface
  // shouldn't shrink silently).
  exports: [PaytrAdapterModule],
})
export class PaymentsModule {}
