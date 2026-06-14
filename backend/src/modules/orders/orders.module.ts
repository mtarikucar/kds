import { Module, forwardRef } from "@nestjs/common";
import { OrdersService } from "./services/orders.service";
import { OrderTransferService } from "./services/order-transfer.service";
import { OrderPricingCalculator } from "./services/order-pricing.calculator";
import { PaymentsService } from "./services/payments.service";
import { PaymentMathCalculator } from "./services/payment-math.calculator";
import { PaymentFinalizer } from "./services/payment-finalizer.service";
import { PaymentValidator } from "./services/payment-validator.service";
import { ReceiptSnapshotBuilder } from "./services/receipt-snapshot.builder";
import { OrdersController } from "./controllers/orders.controller";
import { PaymentsController } from "./controllers/payments.controller";
import { PrismaModule } from "../../prisma/prisma.module";
import { CustomersModule } from "../customers/customers.module";
import { SmsSettingsModule } from "../sms-settings/sms-settings.module";
import { AccountingModule } from "../accounting/accounting.module";
import { KdsModule } from "../kds/kds.module";
import { DeliveryPlatformsModule } from "../delivery-platforms/delivery-platforms.module";
import { StockManagementModule } from "../stock-management/stock-management.module";

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => KdsModule),
    forwardRef(() => DeliveryPlatformsModule),
    forwardRef(() => StockManagementModule),
    CustomersModule,
    SmsSettingsModule,
    AccountingModule,
  ],
  controllers: [OrdersController, PaymentsController],
  providers: [
    OrdersService,
    OrderTransferService,
    // Pure line-item pricing math extracted from OrdersService
    // createInner()/update() (wave-d2 split). Zero deps; OrdersService stays
    // the thin facade owning every $transaction + discount policy.
    OrderPricingCalculator,
    PaymentsService,
    // Refactor split of payments.service.ts: pure per-item math
    // (PaymentMathCalculator, zero deps) + the finalization cluster
    // (PaymentFinalizer — same forwardRef(KdsGateway)/@Optional accounting
    // wiring PaymentsService already carries). PaymentsService remains a
    // thin facade that owns every $transaction boundary.
    PaymentMathCalculator,
    PaymentFinalizer,
    // PASS 3 — pure validation seams (order-state guards, split-total
    // tolerance, item membership/dedup) lifted out of create/splitBill/
    // payByItems. Zero deps, like PaymentMathCalculator.
    PaymentValidator,
    ReceiptSnapshotBuilder,
  ],
  exports: [OrdersService, PaymentsService, ReceiptSnapshotBuilder],
})
export class OrdersModule {}
