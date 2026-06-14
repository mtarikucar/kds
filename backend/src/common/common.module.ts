import { Global, Module } from "@nestjs/common";
import { EmailService } from "./services/email.service";
import { LoggerService } from "./services/logger.service";
import { CLOCK, SystemClock } from "./time/clock";
import { ID_GENERATOR, SystemIdGenerator } from "./ids/id-generator";

/**
 * Global common module
 * Provides shared services across the application
 */
@Global()
@Module({
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
  ],
  exports: [EmailService, LoggerService, CLOCK, ID_GENERATOR],
})
export class CommonModule {}
