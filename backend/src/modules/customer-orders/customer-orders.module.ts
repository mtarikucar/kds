import { Module } from '@nestjs/common';
import { CustomerOrdersService } from './services/customer-orders.service';
import { CustomerOrdersController } from './controllers/customer-orders.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerOrdersController],
  providers: [CustomerOrdersService],
  exports: [CustomerOrdersService],
})
export class CustomerOrdersModule {}
