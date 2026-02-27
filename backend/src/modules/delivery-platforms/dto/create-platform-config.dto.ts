import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { DeliveryPlatform } from '../constants/platform.enum';

export class CreatePlatformConfigDto {
  @ApiProperty({ enum: DeliveryPlatform })
  @IsEnum(DeliveryPlatform)
  platform: DeliveryPlatform;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  credentials?: Record<string, any>;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  remoteRestaurantId?: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  autoAccept?: boolean;
}
