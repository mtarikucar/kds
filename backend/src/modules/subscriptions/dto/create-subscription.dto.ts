import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { BillingCycle } from '../../../common/constants/subscription.enum';

export class CreateSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  planId: string;

  @IsEnum(BillingCycle)
  @IsNotEmpty()
  billingCycle: BillingCycle;
}
