import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { FiscalProviderRegistry } from "./fiscal-provider.registry";
import { FiscalService } from "./fiscal.service";
import { MockFiscalProvider } from "./adapters/mock-fiscal-provider";
import { EfaturaFiscalProvider } from "./adapters/efatura-fiscal-provider";
import { HuginFiscalProvider } from "./adapters/hugin-fiscal-provider";
import { BekoFiscalProvider } from "./adapters/beko-fiscal-provider";
import { PaygoFiscalProvider } from "./adapters/paygo-fiscal-provider";
import { FiscalController } from "./fiscal.controller";
// v2.8.88: FiscalController gates on `@RequiresIntegration('fiscal')`
// via PlanFeatureGuard.
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
// GMP-3 yazarkasa (Hugin/Beko) adapters route fiscal_receipt commands through
// the on-prem local bridge → CommandQueueService (exported by DeviceMeshModule).
import { DeviceMeshModule } from "../device-mesh/device-mesh.module";

/**
 * Fiscal-core module. Vendor-neutral receipt issuance, day-close, and
 * device status. Brand adapters live in adapters/* and self-register
 * with the FiscalProviderRegistry at boot.
 */
@Global()
@Module({
  imports: [PrismaModule, SubscriptionsModule, DeviceMeshModule],
  controllers: [FiscalController],
  providers: [
    FiscalProviderRegistry,
    FiscalService,
    MockFiscalProvider,
    EfaturaFiscalProvider,
    HuginFiscalProvider,
    BekoFiscalProvider,
    PaygoFiscalProvider,
  ],
  exports: [FiscalProviderRegistry, FiscalService],
})
export class FiscalCoreModule {}
