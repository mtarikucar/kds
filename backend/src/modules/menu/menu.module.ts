import { Module } from "@nestjs/common";
import { CategoriesService } from "./services/categories.service";
import { ProductsService } from "./services/products.service";
import { MenuQueryService } from "./services/menu-query.service";
import { MenuImportService } from "./services/menu-import.service";
import { CategoriesController } from "./controllers/categories.controller";
import { ProductsController } from "./controllers/products.controller";
import { QrMenuController } from "./controllers/qr-menu.controller";
import { MenuImportController } from "./controllers/menu-import.controller";
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
  ],
  providers: [
    CategoriesService,
    ProductsService,
    MenuQueryService,
    MenuImportService,
  ],
  exports: [CategoriesService, ProductsService, MenuQueryService],
})
export class MenuModule {}
