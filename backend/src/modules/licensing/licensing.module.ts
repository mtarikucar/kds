import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { LicensingService } from "./licensing.service";

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
  imports: [PrismaModule],
  providers: [LicensingService],
  exports: [LicensingService],
})
export class LicensingModule {}
