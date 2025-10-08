import { Module } from '@nestjs/common';
import { CategoriesService } from './services/categories.service';
import { ProductsService } from './services/products.service';
import { CategoriesController } from './controllers/categories.controller';
import { ProductsController } from './controllers/products.controller';
import { QrMenuController } from './controllers/qr-menu.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CategoriesController, ProductsController, QrMenuController],
  providers: [CategoriesService, ProductsService],
  exports: [CategoriesService, ProductsService],
})
export class MenuModule {}
