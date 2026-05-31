import { Module } from '@nestjs/common';
import { IntegrationsController, HardwareConfigController } from './integrations/integrations.controller';
import { IntegrationsService } from './integrations/integrations.service';
import { PrismaModule } from '../../prisma/prisma.module';
// v2.8.99.1 — IntegrationsController has @UseGuards(PlanFeatureGuard)
// + @RequiresFeature(API_ACCESS); the v2.8.88 entitlement-engine
// rewire pulled EntitlementService into PlanFeatureGuard's
// constructor. Pre-fix the SettingsModule didn't import the
// engine-providing module, so SettingsModule's instance of
// PlanFeatureGuard couldn't resolve EntitlementService at boot:
//   Nest can't resolve dependencies of the PlanFeatureGuard
//   (Reflector, PrismaService, ?)
// Importing SubscriptionsModule (which re-exports the guard) +
// EntitlementsModule (which provides the engine) closes the
// DI graph. EntitlementsModule is a leaf with no inbound deps so
// no cycle risk.
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';

@Module({
  imports: [PrismaModule, SubscriptionsModule, EntitlementsModule],
  controllers: [IntegrationsController, HardwareConfigController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class SettingsModule {}
