import { Module } from "@nestjs/common";
import { CategoriesService } from "./services/categories.service";
import { ProductsService } from "./services/products.service";
import { MenuQueryService } from "./services/menu-query.service";
import { MenuCollectionsService } from "./services/menu-collections.service";
import { MenuCacheService } from "./services/menu-cache.service";
import { MenuImportService } from "./services/menu-import.service";
import { Product3dService } from "./services/product-3d.service";
import { ProductMediaService } from "./services/product-media.service";
import { CategoriesController } from "./controllers/categories.controller";
import { ProductsController } from "./controllers/products.controller";
import { QrMenuController } from "./controllers/qr-menu.controller";
import { MenuImportController } from "./controllers/menu-import.controller";
import { Product3dController } from "./controllers/product-3d.controller";
import { ProductMediaController } from "./controllers/product-media.controller";
import { MenuCollectionsController } from "./controllers/menu-collections.controller";
import { PrismaModule } from "../../prisma/prisma.module";
import { PosSettingsModule } from "../pos-settings/pos-settings.module";
import { UploadModule } from "../upload/upload.module";

@Module({
  // UploadModule exports UploadService so ProductsService can prune orphaned
  // ProductImage rows + their on-disk files when products are deleted or
  // images detached/replaced (otherwise they leak forever — junction-only
  // cascade leaves the images behind).
  imports: [PrismaModule, PosSettingsModule, UploadModule],
  controllers: [
    CategoriesController,
    ProductsController,
    QrMenuController,
    MenuImportController,
    Product3dController,
    ProductMediaController,
    MenuCollectionsController,
  ],
  providers: [
    CategoriesService,
    ProductsService,
    MenuQueryService,
    MenuCollectionsService,
    MenuCacheService,
    MenuImportService,
    Product3dService,
    ProductMediaService,
  ],
  exports: [CategoriesService, ProductsService, MenuQueryService],
})
export class MenuModule {}
