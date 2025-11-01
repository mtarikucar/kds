import { Module } from '@nestjs/common';
import { CategoriesService } from './services/categories.service';
import { ProductsService } from './services/products.service';
import { CategoriesController } from './controllers/categories.controller';
import { ProductsController } from './controllers/products.controller';
import { QrMenuController } from './controllers/qr-menu.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { PosSettingsModule } from '../pos-settings/pos-settings.module';

@Module({
  imports: [PrismaModule, PosSettingsModule],
  controllers: [CategoriesController, ProductsController, QrMenuController],
  providers: [CategoriesService, ProductsService],
  exports: [CategoriesService, ProductsService],
})
export class MenuModule {}
