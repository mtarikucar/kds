import { IsOptional, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateTenantOverridesDto {
  @IsOptional()
  @IsObject()
  featureOverrides?: {
    advancedReports?: boolean | null;
    multiLocation?: boolean | null;
    customBranding?: boolean | null;
    apiAccess?: boolean | null;
    prioritySupport?: boolean | null;
    inventoryTracking?: boolean | null;
    kdsIntegration?: boolean | null;
    reservationSystem?: boolean | null;
  };

  @IsOptional()
  @IsObject()
  limitOverrides?: {
    maxUsers?: number | null;
    maxTables?: number | null;
    maxProducts?: number | null;
    maxCategories?: number | null;
    maxMonthlyOrders?: number | null;
  };
}
