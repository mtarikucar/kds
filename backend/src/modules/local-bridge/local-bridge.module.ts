import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LocalBridgeService } from './local-bridge.service';
import { LocalBridgeController } from './local-bridge.controller';
import { BridgeTokenGuard } from './bridge-token.guard';

@Module({
  imports: [PrismaModule],
  controllers: [LocalBridgeController],
  providers: [LocalBridgeService, BridgeTokenGuard],
  exports: [LocalBridgeService, BridgeTokenGuard],
})
export class LocalBridgeModule {}
