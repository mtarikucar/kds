import { Module } from '@nestjs/common';
import { CustomerOrdersService } from './services/customer-orders.service';
import { CustomerPaymentService } from './services/customer-payment.service';
import { CustomerOrdersController } from './controllers/customer-orders.controller';
import { CustomerPaymentController } from './controllers/customer-payment.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { PosSettingsModule } from '../pos-settings/pos-settings.module';
import { KdsModule } from '../kds/kds.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [PrismaModule, PosSettingsModule, KdsModule, CustomersModule],
  controllers: [CustomerOrdersController, CustomerPaymentController],
  providers: [CustomerOrdersService, CustomerPaymentService],
  exports: [CustomerOrdersService, CustomerPaymentService],
})
export class CustomerOrdersModule {}
