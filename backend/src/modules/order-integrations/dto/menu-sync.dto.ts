import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsArray,
} from 'class-validator';
import { PlatformType } from '../constants';

export class TriggerMenuSyncDto {
  @IsOptional()
  @IsBoolean()
  fullSync?: boolean; // If true, sync all products; if false, only changed

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[]; // Specific products to sync
}

export class TriggerAvailabilitySyncDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[]; // Specific products to sync; if empty, sync all
}

export class TriggerPriceSyncDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[]; // Specific products to sync; if empty, sync all
}

export class SetRestaurantStatusDto {
  @IsBoolean()
  isOpen: boolean;

  @IsOptional()
  @IsString()
  closedReason?: string;
}

export class SyncStatusResponseDto {
  platformType: PlatformType;
  lastSyncedAt: Date | null;
  lastSyncStatus: 'SUCCESS' | 'FAILED' | 'PARTIAL' | null;
  lastSyncError: string | null;
  syncedProducts: number;
  syncedModifiers: number;
  pendingSync: number;
  isEnabled: boolean;
  isConfigured: boolean;
}
