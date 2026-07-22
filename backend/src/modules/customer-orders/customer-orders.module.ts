import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CustomerOrdersService } from "./services/customer-orders.service";
import { CustomerOrdersController } from "./controllers/customer-orders.controller";
import { CustomerSelfPayService } from "./services/customer-self-pay.service";
import { SelfPayReservationService } from "./services/self-pay-reservation.service";
import { SelfPayQueryService } from "./services/self-pay-query.service";
import { SelfPayIntentService } from "./services/self-pay-intent.service";
import { SelfPayWebhookService } from "./services/self-pay-webhook.service";
import { SelfPaySweeperService } from "./services/self-pay-sweeper.service";
import { SelfPayRecoveryService } from "./services/self-pay-recovery.service";
import { CustomerSelfPayController } from "./controllers/customer-self-pay.controller";
import { PrismaModule } from "../../prisma/prisma.module";
import { PosSettingsModule } from "../pos-settings/pos-settings.module";
import { KdsModule } from "../kds/kds.module";
import { CustomersModule } from "../customers/customers.module";
import { StockManagementModule } from "../stock-management/stock-management.module";
import { OrdersModule } from "../orders/orders.module";
import { PaytrAdapterModule } from "../payments/adapters/paytr-adapter.module";
import { DemoGuardModule } from "../demo/demo-guard.module";

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
    // DemoGuardService — blocks real-money initiation for the @Public
    // customer self-pay intent on the shared demo tenant.
    DemoGuardModule,
  ],
  controllers: [CustomerOrdersController, CustomerSelfPayController],
  providers: [
    CustomerOrdersService,
    CustomerSelfPayService,
    SelfPayReservationService,
    SelfPayQueryService,
    SelfPayIntentService,
    SelfPayWebhookService,
    SelfPaySweeperService,
    SelfPayRecoveryService,
  ],
  exports: [
    CustomerOrdersService,
    CustomerSelfPayService,
    // Exported so the orders module's PaymentsService (which consults the
    // reservation map) can inject the reservation collaborator directly.
    SelfPayReservationService,
    // Exported so the partner /display surface can adapt these verbatim
    // (PartnerModule imports CustomerOrdersModule).
    SelfPayQueryService,
    SelfPayIntentService,
  ],
})
export class CustomerOrdersModule {}
