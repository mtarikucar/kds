import { Module, forwardRef } from '@nestjs/common';
import { OrdersService } from './services/orders.service';
import { PaymentsService } from './services/payments.service';
import { OrdersController } from './controllers/orders.controller';
import { PaymentsController } from './controllers/payments.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => import('../kds/kds.module').then(m => m.KdsModule)),
    CustomersModule,
  ],
  controllers: [OrdersController, PaymentsController],
  providers: [OrdersService, PaymentsService],
  exports: [OrdersService, PaymentsService],
})
export class OrdersModule {}
