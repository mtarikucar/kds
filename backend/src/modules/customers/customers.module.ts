import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { CustomerPublicController } from './customer-public.controller';
import { LoyaltyService } from './loyalty.service';
import { CustomerSessionService } from './customer-session.service';

@Module({
  controllers: [CustomersController, CustomerPublicController],
  providers: [CustomersService, LoyaltyService, CustomerSessionService],
  exports: [CustomersService, LoyaltyService, CustomerSessionService],
})
export class CustomersModule {}
