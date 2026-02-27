import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';

// Controllers
import { StockItemCategoriesController } from './controllers/stock-item-categories.controller';
import { StockItemsController } from './controllers/stock-items.controller';
import { RecipesController } from './controllers/recipes.controller';
import { SuppliersController } from './controllers/suppliers.controller';
import { PurchaseOrdersController } from './controllers/purchase-orders.controller';
import { IngredientMovementsController } from './controllers/ingredient-movements.controller';
import { WasteLogsController } from './controllers/waste-logs.controller';
import { StockCountsController } from './controllers/stock-counts.controller';
import { StockSettingsController } from './controllers/stock-settings.controller';
import { StockDashboardController } from './controllers/stock-dashboard.controller';

// Services
import { StockItemCategoriesService } from './services/stock-item-categories.service';
import { StockItemsService } from './services/stock-items.service';
import { RecipesService } from './services/recipes.service';
import { SuppliersService } from './services/suppliers.service';
import { PurchaseOrdersService } from './services/purchase-orders.service';
import { IngredientMovementsService } from './services/ingredient-movements.service';
import { WasteLogsService } from './services/waste-logs.service';
import { StockCountsService } from './services/stock-counts.service';
import { StockSettingsService } from './services/stock-settings.service';
import { StockDeductionService } from './services/stock-deduction.service';
import { StockAlertsService } from './services/stock-alerts.service';
import { StockDashboardService } from './services/stock-dashboard.service';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => import('../kds/kds.module').then(m => m.KdsModule)),
  ],
  controllers: [
    StockItemCategoriesController,
    StockItemsController,
    RecipesController,
    SuppliersController,
    PurchaseOrdersController,
    IngredientMovementsController,
    WasteLogsController,
    StockCountsController,
    StockSettingsController,
    StockDashboardController,
  ],
  providers: [
    StockItemCategoriesService,
    StockItemsService,
    RecipesService,
    SuppliersService,
    PurchaseOrdersService,
    IngredientMovementsService,
    WasteLogsService,
    StockCountsService,
    StockSettingsService,
    StockDeductionService,
    StockAlertsService,
    StockDashboardService,
  ],
  exports: [
    StockDeductionService,
    StockAlertsService,
    StockItemsService,
  ],
})
export class StockManagementModule {}
