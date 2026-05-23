import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CallerService } from './caller.service';
import { CallerController } from './caller.controller';
import { MockCallerProvider } from './adapters/mock-caller.provider';

@Module({
  imports: [PrismaModule],
  controllers: [CallerController],
  providers: [CallerService, MockCallerProvider],
  exports: [CallerService],
})
export class CallerModule {}
