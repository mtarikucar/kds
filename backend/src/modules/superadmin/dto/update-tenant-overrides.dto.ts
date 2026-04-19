import {
  IsOptional,
  ValidateNested,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FeatureOverridesDto {
  @IsOptional()
  @IsBoolean()
  advancedReports?: boolean | null;

  @IsOptional()
  @IsBoolean()
  multiLocation?: boolean | null;

  @IsOptional()
  @IsBoolean()
  customBranding?: boolean | null;

  @IsOptional()
  @IsBoolean()
  apiAccess?: boolean | null;

  @IsOptional()
  @IsBoolean()
  prioritySupport?: boolean | null;

  @IsOptional()
  @IsBoolean()
  inventoryTracking?: boolean | null;

  @IsOptional()
  @IsBoolean()
  kdsIntegration?: boolean | null;

  @IsOptional()
  @IsBoolean()
  reservationSystem?: boolean | null;

  @IsOptional()
  @IsBoolean()
  personnelManagement?: boolean | null;

  @IsOptional()
  @IsBoolean()
  deliveryIntegration?: boolean | null;
}

export class LimitOverridesDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  maxUsers?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxTables?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxProducts?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxCategories?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxMonthlyOrders?: number | null;
}

export class UpdateTenantOverridesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => FeatureOverridesDto)
  featureOverrides?: FeatureOverridesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LimitOverridesDto)
  limitOverrides?: LimitOverridesDto;
}
