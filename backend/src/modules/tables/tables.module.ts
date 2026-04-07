import { Module } from '@nestjs/common';
import { TablesService } from './tables.service';
import { TablesController } from './tables.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { KdsModule } from '../kds/kds.module';

@Module({
  imports: [PrismaModule, KdsModule],
  controllers: [TablesController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}
