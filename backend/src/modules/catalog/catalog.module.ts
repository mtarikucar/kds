import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SuperAdminModule } from '../superadmin/superadmin.module';
import { CatalogService } from './catalog.service';
import { CatalogController, SuperadminCatalogController } from './catalog.controller';

@Module({
  imports: [PrismaModule, SuperAdminModule],
  controllers: [CatalogController, SuperadminCatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
