import { IsString, IsNotEmpty, IsOptional, IsNumber, IsInt, IsDateString, Min } from 'class-validator';
import { EmptyStringToNumber } from '../../../common/dto/transforms';

export class CreateOfferDto {
  @IsString()
  @IsNotEmpty()
  leadId: string;

  @IsOptional()
  @IsString()
  planId?: string;

  @EmptyStringToNumber()
  @IsOptional()
  @IsNumber()
  @Min(0)
  customPrice?: number;

  @EmptyStringToNumber()
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(0)
  trialDays?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;
}
