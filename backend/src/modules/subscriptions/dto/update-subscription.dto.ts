import { IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { BillingCycle } from '../../../common/constants/subscription.enum';

export class UpdateSubscriptionDto {
  @IsEnum(BillingCycle)
  @IsOptional()
  billingCycle?: BillingCycle;

  @IsBoolean()
  @IsOptional()
  autoRenew?: boolean;

  @IsBoolean()
  @IsOptional()
  cancelAtPeriodEnd?: boolean;
}
