import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsArray,
  Min,
  Max,
} from 'class-validator';
import { PlatformType } from '../constants';

export class BasePlatformConfigDto {
  @IsBoolean()
  autoAccept: boolean;

  @IsNumber()
  @Min(1)
  @Max(120)
  defaultPrepTime: number; // minutes
}

export class TrendyolConfigDto extends BasePlatformConfigDto {
  @IsString()
  apiKey: string;

  @IsString()
  apiSecret: string;

  @IsString()
  storeId: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;
}

export class YemeksepetiConfigDto extends BasePlatformConfigDto {
  @IsString()
  clientId: string;

  @IsString()
  clientSecret: string;

  @IsString()
  vendorId: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;
}

export class GetirConfigDto extends BasePlatformConfigDto {
  @IsString()
  apiKey: string;

  @IsString()
  restaurantId: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;
}

export class MigrosConfigDto extends BasePlatformConfigDto {
  @IsString()
  clientId: string;

  @IsString()
  clientSecret: string;

  @IsString()
  storeCode: string;

  @IsOptional()
  @IsString()
  certificatePath?: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;
}

export class FuudyConfigDto extends BasePlatformConfigDto {
  @IsString()
  apiKey: string;

  @IsString()
  restaurantId: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ipWhitelist?: string[];
}

export class ConfigurePlatformDto {
  @IsEnum(PlatformType)
  platformType: PlatformType;

  // Config will be validated based on platformType
  config:
    | TrendyolConfigDto
    | YemeksepetiConfigDto
    | GetirConfigDto
    | MigrosConfigDto
    | FuudyConfigDto;
}

export class TogglePlatformDto {
  @IsBoolean()
  isEnabled: boolean;
}
