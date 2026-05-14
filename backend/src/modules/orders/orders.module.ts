import { Module, forwardRef } from '@nestjs/common';
import { OrdersService } from './services/orders.service';
import { PaymentsService } from './services/payments.service';
import { ReceiptSnapshotBuilder } from './services/receipt-snapshot.builder';
import { OrdersController } from './controllers/orders.controller';
import { PaymentsController } from './controllers/payments.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CustomersModule } from '../customers/customers.module';
import { SmsSettingsModule } from '../sms-settings/sms-settings.module';
import { AccountingModule } from '../accounting/accounting.module';
import { KdsModule } from '../kds/kds.module';
import { DeliveryPlatformsModule } from '../delivery-platforms/delivery-platforms.module';
import { StockManagementModule } from '../stock-management/stock-management.module';

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
  providers: [OrdersService, PaymentsService, ReceiptSnapshotBuilder],
  exports: [OrdersService, PaymentsService, ReceiptSnapshotBuilder],
})
export class OrdersModule {}
