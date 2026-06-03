import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CustomerOrdersService } from "./services/customer-orders.service";
import { CustomerOrdersController } from "./controllers/customer-orders.controller";
import { CustomerSelfPayService } from "./services/customer-self-pay.service";
import { CustomerSelfPayController } from "./controllers/customer-self-pay.controller";
import { PrismaModule } from "../../prisma/prisma.module";
import { PosSettingsModule } from "../pos-settings/pos-settings.module";
import { KdsModule } from "../kds/kds.module";
import { CustomersModule } from "../customers/customers.module";
import { StockManagementModule } from "../stock-management/stock-management.module";
import { OrdersModule } from "../orders/orders.module";
import { PaytrAdapterModule } from "../payments/adapters/paytr-adapter.module";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    PosSettingsModule,
    KdsModule,
    CustomersModule,
    PaytrAdapterModule,
    forwardRef(() => StockManagementModule),
    forwardRef(() => OrdersModule),
  ],
  controllers: [CustomerOrdersController, CustomerSelfPayController],
  providers: [CustomerOrdersService, CustomerSelfPayService],
  exports: [CustomerOrdersService, CustomerSelfPayService],
})
export class CustomerOrdersModule {}
