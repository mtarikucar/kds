import { Module } from '@nestjs/common';
import { CustomerOrdersService } from './services/customer-orders.service';
import { CustomerOrdersController } from './controllers/customer-orders.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { PosSettingsModule } from '../pos-settings/pos-settings.module';
import { KdsModule } from '../kds/kds.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [PrismaModule, PosSettingsModule, KdsModule, CustomersModule],
  controllers: [CustomerOrdersController],
  providers: [CustomerOrdersService],
  exports: [CustomerOrdersService],
})
export class CustomerOrdersModule {}
