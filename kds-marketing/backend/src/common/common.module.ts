import { Global, Module } from '@nestjs/common';
import { EmailService } from './services/email.service';

/**
 * Global common module — slim standalone version of the monorepo's
 * CommonModule. Only EmailService survived the split (the marketing
 * tenant-welcome email); everything else was core-only infrastructure.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class CommonModule {}
