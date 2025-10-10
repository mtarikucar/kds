import { IsEnum, IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { BillingCycle } from '../../../common/constants/subscription.enum';

export class ChangePlanDto {
  @IsString()
  @IsNotEmpty()
  newPlanId: string;

  @IsEnum(BillingCycle)
  @IsOptional()
  billingCycle?: BillingCycle;

  @IsString()
  @IsOptional()
  paymentMethodId?: string; // Required for upgrades
}
