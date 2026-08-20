import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { EmailService } from "./services/email.service";
import { LoggerService } from "./services/logger.service";
import { CLOCK, SystemClock } from "./time/clock";
import { ID_GENERATOR, SystemIdGenerator } from "./ids/id-generator";
import { CountryService } from "./country/country.service";
import { CountryCapabilityResolver } from "./country/country-capability.resolver";
import { PaymentsCoreModule } from "../modules/payments-core/payments-core.module";
import { FiscalCoreModule } from "../modules/fiscal-core/fiscal-core.module";
import { DeviceMeshModule } from "../modules/device-mesh/device-mesh.module";

/**
 * Global common module
 * Provides shared services across the application
 */
@Global()
@Module({
  // PrismaModule is @Global() itself, but CountryService genuinely depends
  // on PrismaService — importing it explicitly (rather than relying on some
  // other module in the graph happening to load it first) keeps this
  // module's dependency graph honest, same posture as EntitlementsModule /
  // LicensingModule / OutboxModule / CreditsModule.
  //
  // PaymentsCoreModule and FiscalCoreModule are @Global() too (their
  // registries would resolve here regardless), but CountryCapabilityResolver
  // genuinely depends on PaymentProviderRegistry/FiscalProviderRegistry, so
  // they're imported explicitly for the same "honest graph" reason. DeviceMeshModule
  // is NOT @Global() — importing it here is the only way
  // CountryCapabilityResolver can inject EscPosBuilderRegistry at all.
  // One-way edge, verified: neither DeviceMeshModule nor its own imports
  // (PrismaModule, CommandQueueModule, LocalBridgeModule, SubscriptionsModule
  // and what THEY import) ever import CommonModule back — grepping every
  // `*.module.ts` for `CommonModule` turns up only app.module.ts,
  // common.module.ts itself, metrics.module.ts, reservations.module.ts and
  // z-reports.module.ts, none of which sit in this chain.
  imports: [
    PrismaModule,
    PaymentsCoreModule,
    FiscalCoreModule,
    DeviceMeshModule,
  ],
  providers: [
    EmailService,
    {
      provide: LoggerService,
      useValue: new LoggerService("App"),
    },
    // Testability primitives: injectable wall-clock and id/randomness source.
    // Bound by token here (and re-exported) so any feature module can inject
    // a deterministic substitute under test while production uses the real
    // platform clock / crypto. See docs/quality/testability-standard.md.
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: SystemIdGenerator },
    // Consumed by RequestContextInterceptor (a global APP_INTERCEPTOR on
    // every HTTP request) and by anything needing tenant-country parameters
    // — tax rates, phone region, currency. Registering it here is what makes
    // it injectable at all; before this it threw UnknownDependenciesException
    // at bootstrap the moment anything tried to inject it.
    CountryService,
    // Task 9 (Phase 2, capability routing). Depends on CountryService above
    // plus the three registries pulled in via the imports just added.
    CountryCapabilityResolver,
  ],
  exports: [
    EmailService,
    LoggerService,
    CLOCK,
    ID_GENERATOR,
    CountryService,
    CountryCapabilityResolver,
  ],
})
export class CommonModule {}
