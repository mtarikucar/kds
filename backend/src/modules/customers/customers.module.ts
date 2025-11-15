import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { CustomerPublicController } from './customer-public.controller';
import { LoyaltyService } from './loyalty.service';
import { CustomerSessionService } from './customer-session.service';
import { PhoneVerificationService } from './phone-verification.service';
import { ReferralService } from './referral.service';

@Module({
  controllers: [CustomersController, CustomerPublicController],
  providers: [
    CustomersService,
    LoyaltyService,
    CustomerSessionService,
    PhoneVerificationService,
    ReferralService,
  ],
  exports: [
    CustomersService,
    LoyaltyService,
    CustomerSessionService,
    PhoneVerificationService,
    ReferralService,
  ],
})
export class CustomersModule {}
