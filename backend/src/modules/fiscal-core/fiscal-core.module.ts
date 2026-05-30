import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FiscalProviderRegistry } from './fiscal-provider.registry';
import { FiscalService } from './fiscal.service';
import { MockFiscalProvider } from './adapters/mock-fiscal-provider';
import { EfaturaFiscalProvider } from './adapters/efatura-fiscal-provider';
import { FiscalController } from './fiscal.controller';
// v2.8.88: FiscalController gates on `@RequiresIntegration('fiscal')`
// via PlanFeatureGuard.
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

/**
 * Fiscal-core module. Vendor-neutral receipt issuance, day-close, and
 * device status. Brand adapters live in adapters/* and self-register
 * with the FiscalProviderRegistry at boot.
 */
@Global()
@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [FiscalController],
  providers: [FiscalProviderRegistry, FiscalService, MockFiscalProvider, EfaturaFiscalProvider],
  exports: [FiscalProviderRegistry, FiscalService],
})
export class FiscalCoreModule {}
