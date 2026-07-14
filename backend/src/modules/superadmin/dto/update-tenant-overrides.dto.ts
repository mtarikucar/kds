import {
  IsOptional,
  ValidateNested,
  IsBoolean,
  IsInt,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import {
  EmptyStringToNumber,
  StringToBoolean,
} from "../../../common/dto/transforms";

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
  externalDisplay?: boolean | null;

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

  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  posAccess?: boolean | null;

  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  aiContentGeneration?: boolean | null;
}

// A limit override REPLACES the plan value in the entitlement engine, so the
// minimum is -1 (the unlimited sentinel), NOT 0. With @Min(-1) an override
// could never represent "unlimited": once a 0 override was set on a BUSINESS
// tenant it capped every limit at zero AND could not be undone from the
// override form (only deleting the override restored the plan default). -1
// lets ops explicitly grant unlimited.
export class LimitOverridesDto {
  @Type(() => String)
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(-1)
  maxUsers?: number | null;

  @Type(() => String)
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(-1)
  maxTables?: number | null;

  @Type(() => String)
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(-1)
  maxBranches?: number | null;

  @Type(() => String)
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(-1)
  maxProducts?: number | null;

  @Type(() => String)
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(-1)
  maxCategories?: number | null;

  @Type(() => String)
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(-1)
  maxMonthlyOrders?: number | null;

  @Type(() => String)
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(-1)
  maxMonthlyAiPhotos?: number | null;

  @Type(() => String)
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(-1)
  maxMonthlyAiVideos?: number | null;
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
