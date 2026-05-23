import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DeviceMeshModule } from '../device-mesh/device-mesh.module';
import { KdsRoutingService } from './kds-routing.service';

@Module({
  imports: [PrismaModule, DeviceMeshModule],
  providers: [KdsRoutingService],
})
export class KdsRoutingModule {}
