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

/**
 * A limit override REPLACES the engine's value, so the minimum is -1 (the
 * unlimited sentinel), not 0 — a 0 override once capped a tenant at zero with
 * no way back from the form.
 *
 * Only maxBranches survives v3.3.0. The other caps are granted as -1 by the
 * free baseline and read by nothing, so accepting them here would take an
 * operator's number and silently discard it.
 */
export class LimitOverridesDto {
  @Type(() => String)
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(-1)
  maxBranches?: number | null;
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
