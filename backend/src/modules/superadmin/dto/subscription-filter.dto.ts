import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsUUID, IsOptional, IsString, IsInt, Min, Max, IsNumber, IsBoolean, IsDateString, MaxLength } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';

const SUBSCRIPTION_STATUSES = [
  'ACTIVE',
  'CANCELLED',
  'EXPIRED',
  'PAST_DUE',
  'TRIALING',
] as const;

export class SubscriptionFilterDto {
  @ApiPropertyOptional({ enum: SUBSCRIPTION_STATUSES })
  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUSES)
  status?: (typeof SUBSCRIPTION_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Filter by plan ID' })
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional({ description: 'Filter by tenant ID' })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class CreatePlanDto {
  @ApiProperty()
  @IsString()
  @MaxLength(50)
  name: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  displayName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyPrice: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  yearlyPrice: number;

  @ApiPropertyOptional({ default: 'TRY' })
  @IsOptional()
  @IsString()
  currency?: string = 'TRY';

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  trialDays?: number = 0;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  maxUsers?: number = 1;

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  maxTables?: number = 5;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  maxProducts?: number = 50;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  maxCategories?: number = 10;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  maxMonthlyOrders?: number = 100;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  advancedReports?: boolean = false;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  multiLocation?: boolean = false;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  customBranding?: boolean = false;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  apiAccess?: boolean = false;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  prioritySupport?: boolean = false;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  inventoryTracking?: boolean = false;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  kdsIntegration?: boolean = true;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  reservationSystem?: boolean = false;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  personnelManagement?: boolean = false;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  deliveryIntegration?: boolean = false;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;

  @ApiPropertyOptional({ description: 'Discount percentage (0-100)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercentage?: number;

  @ApiPropertyOptional({ description: 'Discount label (e.g. "Ramazan Kampanyasi")' })
  @IsOptional()
  @IsString()
  discountLabel?: string;

  @ApiPropertyOptional({ description: 'Discount start date (ISO string)' })
  @IsOptional()
  @IsDateString()
  discountStartDate?: string;

  @ApiPropertyOptional({ description: 'Discount end date (ISO string)' })
  @IsOptional()
  @IsDateString()
  discountEndDate?: string;

  @ApiPropertyOptional({ description: 'Whether discount is active', default: false })
  @IsOptional()
  @IsBoolean()
  isDiscountActive?: boolean;
}

// PATCH semantics: every field optional so clients don't have to resend
// the whole plan when touching a single attribute.
export class UpdatePlanDto extends PartialType(CreatePlanDto) {}

export class ExtendSubscriptionDto {
  @ApiProperty({ description: 'Number of days to extend' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days: number;

  @ApiPropertyOptional({ description: 'Reason for extension' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateSubscriptionDto {
  @ApiPropertyOptional({ description: 'New plan ID' })
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional({ enum: SUBSCRIPTION_STATUSES })
  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUSES)
  status?: (typeof SUBSCRIPTION_STATUSES)[number];
}
