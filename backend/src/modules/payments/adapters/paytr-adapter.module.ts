import { Module } from '@nestjs/common';
import { PaytrAdapter } from './paytr.adapter';

/**
 * Standalone module wrapping the PayTR HTTP adapter.
 *
 * Both PaymentsModule (intent creation, webhook) and SubscriptionsModule
 * (recurring auto-charge in the scheduler) need the adapter. Keeping it
 * in PaymentsModule and importing PaymentsModule from SubscriptionsModule
 * would create a cycle (PaymentsModule already imports SubscriptionsModule
 * for BillingService). Hoisting the adapter into its own tiny module
 * breaks the cycle cleanly.
 */
@Module({
  providers: [PaytrAdapter],
  exports: [PaytrAdapter],
})
export class PaytrAdapterModule {}
