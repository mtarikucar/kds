import { Module } from '@nestjs/common';
import { IntegrationsController, HardwareConfigController } from './integrations/integrations.controller';
import { IntegrationsService } from './integrations/integrations.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [IntegrationsController, HardwareConfigController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class SettingsModule {}
