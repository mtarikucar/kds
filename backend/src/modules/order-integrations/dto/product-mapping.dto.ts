import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PlatformType } from '../constants';

export class CreateProductMappingDto {
  @IsString()
  productId: string;

  @IsString()
  platformProductId: string;

  @IsOptional()
  @IsString()
  platformCategoryId?: string;

  @IsOptional()
  @IsBoolean()
  syncPrice?: boolean;

  @IsOptional()
  @IsBoolean()
  syncAvailability?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(10)
  priceMultiplier?: number;
}

export class UpdateProductMappingDto {
  @IsOptional()
  @IsString()
  platformProductId?: string;

  @IsOptional()
  @IsString()
  platformCategoryId?: string;

  @IsOptional()
  @IsBoolean()
  syncPrice?: boolean;

  @IsOptional()
  @IsBoolean()
  syncAvailability?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(10)
  priceMultiplier?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class BulkProductMappingDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductMappingDto)
  mappings: CreateProductMappingDto[];
}

export class CreateModifierMappingDto {
  @IsString()
  modifierId: string;

  @IsString()
  platformModifierId: string;

  @IsOptional()
  @IsString()
  platformGroupId?: string;

  @IsOptional()
  @IsBoolean()
  syncPrice?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(10)
  priceMultiplier?: number;
}

export class UpdateModifierMappingDto {
  @IsOptional()
  @IsString()
  platformModifierId?: string;

  @IsOptional()
  @IsString()
  platformGroupId?: string;

  @IsOptional()
  @IsBoolean()
  syncPrice?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(10)
  priceMultiplier?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class BulkModifierMappingDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateModifierMappingDto)
  mappings: CreateModifierMappingDto[];
}

export class ProductMappingQueryDto {
  @IsOptional()
  @IsEnum(PlatformType)
  platformType?: PlatformType;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  unmappedOnly?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  offset?: number;
}
