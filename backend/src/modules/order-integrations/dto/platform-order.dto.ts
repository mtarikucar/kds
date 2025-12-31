import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PlatformType } from '../constants';

export class AcceptPlatformOrderDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  estimatedPrepTime?: number; // minutes
}

export class RejectPlatformOrderDto {
  @IsString()
  reason: string;
}

export class PlatformOrderFilterDto {
  @IsOptional()
  @IsEnum(PlatformType)
  platformType?: PlatformType;

  @IsOptional()
  @IsString()
  status?: string; // Comma-separated statuses

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  offset?: number;
}

export class PlatformOrderItemDto {
  @IsString()
  platformProductId: string;

  @IsString()
  name: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unitPrice: number;

  @IsNumber()
  totalPrice: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlatformOrderItemModifierDto)
  modifiers?: PlatformOrderItemModifierDto[];
}

export class PlatformOrderItemModifierDto {
  @IsString()
  platformModifierId: string;

  @IsString()
  name: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  price: number;
}
