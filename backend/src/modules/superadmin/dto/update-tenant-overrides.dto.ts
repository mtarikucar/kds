import {
  IsOptional,
  ValidateNested,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EmptyStringToNumber, StringToBoolean } from '../../../common/dto/transforms';

export class FeatureOverridesDto {
  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  advancedReports?: boolean | null;

  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  multiLocation?: boolean | null;

  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  customBranding?: boolean | null;

  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  apiAccess?: boolean | null;

  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  prioritySupport?: boolean | null;

  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  inventoryTracking?: boolean | null;

  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  kdsIntegration?: boolean | null;

  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  reservationSystem?: boolean | null;

  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  personnelManagement?: boolean | null;

  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  deliveryIntegration?: boolean | null;
}

export class LimitOverridesDto {
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(0)
  maxUsers?: number | null;

  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(0)
  maxTables?: number | null;

  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(0)
  maxProducts?: number | null;

  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(0)
  maxCategories?: number | null;

  @EmptyStringToNumber()
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
