import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { EmailService } from "./services/email.service";
import { LoggerService } from "./services/logger.service";
import { CLOCK, SystemClock } from "./time/clock";
import { ID_GENERATOR, SystemIdGenerator } from "./ids/id-generator";
import { CountryService } from "./country/country.service";
import { CountryCapabilityResolver } from "./country/country-capability.resolver";

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
  // CountryCapabilityResolver (below) also depends on PaymentProviderRegistry
  // / FiscalProviderRegistry / EscPosBuilderRegistry, but those are NOT
  // imported here. All three live in their own small @Global() modules
  // (payments-core, fiscal-core, printing-core) that are already part of the
  // app graph via AppModule — a @Global() module's exports are ambient
  // everywhere once loaded ONCE anywhere, so adding them here would only add
  // graph edges, not change resolution (fix round 1: they used to be listed
  // here, which is exactly the mistake being corrected).
  //
  // CommonModule is itself @Global(), which puts every module in the app
  // downstream of it — so it must never import a feature module (that
  // inverts the dependency direction and is one edge away from a real
  // cycle the moment that feature module's own subtree grows to need
  // anything CommonModule provides). DeviceMeshModule briefly lived in this
  // imports array for EscPosBuilderRegistry; it was removed once
  // EscPosBuilderRegistry got its own leaf @Global() module (printing-core)
  // to depend on instead, mirroring payments-core/fiscal-core.
  imports: [PrismaModule],
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
    // and on the three @Global() registries described in the imports
    // comment — resolved ambiently, no explicit import needed.
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
