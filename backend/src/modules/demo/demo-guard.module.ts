import { Module } from "@nestjs/common";
import { DemoGuardService } from "./demo-guard.service";

/**
 * Deliberately lightweight standalone module — provides+exports ONLY
 * DemoGuardService. PrismaModule is @Global() (see prisma.module.ts), so it
 * doesn't need to be imported here for DemoGuardService's constructor to
 * resolve.
 *
 * Consuming modules (Payments, BankTransfer, Subscriptions, Checkout,
 * CustomerOrders) import THIS module, never DemoService/AuthModule directly
 * — DemoService pulls in the whole demo-seeding graph (bcrypt, cron, order
 * seeding) and AuthModule itself depends on SubscriptionsModule, which risks
 * circular imports with the payment-adjacent modules that need this guard.
 */
@Module({
  providers: [DemoGuardService],
  exports: [DemoGuardService],
})
export class DemoGuardModule {}
