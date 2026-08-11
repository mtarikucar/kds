import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { LicensingService } from "./licensing.service";
import { RenewalCycleService } from "./renewal-cycle.service";
import { RenewalSchedulerService } from "./renewal-scheduler.service";
import { CheckoutModule } from "../checkout/checkout.module";
import { OutboxModule } from "../outbox/outbox.module";

/**
 * Anniversary + proration for the à-la-carte model.
 *
 * `@Global()` for the same reason EntitlementsModule is: pricing is needed by
 * the checkout quote engine, the marketplace provisioner, the renewal
 * scheduler and the licence read API, which live in four unrelated feature
 * modules. Making each of them import a licensing module would be four
 * chances to forget one — and forgetting one means a product provisioned with
 * a rolling 30-day period instead of an anniversary-aligned one, which does
 * not fail loudly; it just quietly bills the customer wrong.
 *
 * EntitlementService (the `feature.license` read) is itself global, so this
 * module only has to bring Prisma.
 */
@Global()
@Module({
  // forwardRef-free: CheckoutModule provides QuoteService (the renewal cart is
  // priced through the same engine as any other cart) and does not import
  // this module back — LicensingService reaches checkout through the @Global()
  // export, not an import.
  imports: [PrismaModule, CheckoutModule, OutboxModule],
  providers: [LicensingService, RenewalCycleService, RenewalSchedulerService],
  exports: [LicensingService, RenewalCycleService],
})
export class LicensingModule {}
