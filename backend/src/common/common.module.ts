import { Global, Module } from '@nestjs/common';
import { EmailService } from './services/email.service';
import { LoggerService } from './services/logger.service';

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
      useValue: new LoggerService('App'),
    },
  ],
  exports: [EmailService, LoggerService],
})
export class CommonModule {}
