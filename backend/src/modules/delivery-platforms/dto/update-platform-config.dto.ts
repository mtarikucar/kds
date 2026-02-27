import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdatePlatformConfigDto {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  credentials?: Record<string, any>;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  remoteRestaurantId?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  autoAccept?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notifySound?: string;
}
