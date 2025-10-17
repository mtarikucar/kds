import { Module } from '@nestjs/common';
import { PosSettingsService } from './pos-settings.service';
import { PosSettingsController } from './pos-settings.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PosSettingsController],
  providers: [PosSettingsService],
  exports: [PosSettingsService],
})
export class PosSettingsModule {}
