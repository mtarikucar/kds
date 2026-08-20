import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { EmailService } from "./services/email.service";
import { LoggerService } from "./services/logger.service";
import { CLOCK, SystemClock } from "./time/clock";
import { ID_GENERATOR, SystemIdGenerator } from "./ids/id-generator";
import { CountryService } from "./country/country.service";

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
  ],
  exports: [EmailService, LoggerService, CLOCK, ID_GENERATOR, CountryService],
})
export class CommonModule {}
