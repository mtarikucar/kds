import { IsString, IsIn } from 'class-validator';

export class CreateIntentDto {
  @IsString()
  planId: string;

  @IsIn(['MONTHLY', 'YEARLY'])
  billingCycle: 'MONTHLY' | 'YEARLY';
}
