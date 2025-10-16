import { IsString, IsBoolean, IsOptional, IsInt, Min, Max, IsHexColor, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateQrSettingsDto {
  @ApiPropertyOptional({ description: 'Primary color (hex)', example: '#3B82F6' })
  @IsHexColor()
  @IsOptional()
  primaryColor?: string;

  @ApiPropertyOptional({ description: 'Secondary color (hex)', example: '#1F2937' })
  @IsHexColor()
  @IsOptional()
  secondaryColor?: string;

  @ApiPropertyOptional({ description: 'Background color (hex)', example: '#F9FAFB' })
  @IsHexColor()
  @IsOptional()
  backgroundColor?: string;

  @ApiPropertyOptional({ description: 'Font family', example: 'Inter' })
  @IsString()
  @IsOptional()
  fontFamily?: string;

  @ApiPropertyOptional({ description: 'Logo URL' })
  @IsString()
  @IsOptional()
  logoUrl?: string;

  @ApiPropertyOptional({ description: 'Show restaurant information' })
  @IsBoolean()
  @IsOptional()
  showRestaurantInfo?: boolean;

  @ApiPropertyOptional({ description: 'Show prices' })
  @IsBoolean()
  @IsOptional()
  showPrices?: boolean;

  @ApiPropertyOptional({ description: 'Show product descriptions' })
  @IsBoolean()
  @IsOptional()
  showDescription?: boolean;

  @ApiPropertyOptional({ description: 'Show product images' })
  @IsBoolean()
  @IsOptional()
  showImages?: boolean;

  @ApiPropertyOptional({ description: 'Layout style', enum: ['GRID', 'LIST', 'COMPACT'] })
  @IsIn(['GRID', 'LIST', 'COMPACT'])
  @IsOptional()
  layoutStyle?: string;

  @ApiPropertyOptional({ description: 'Items per row (1-4)', minimum: 1, maximum: 4 })
  @IsInt()
  @Min(1)
  @Max(4)
  @IsOptional()
  itemsPerRow?: number;

  @ApiPropertyOptional({ description: 'Enable table-specific QR codes' })
  @IsBoolean()
  @IsOptional()
  enableTableQR?: boolean;

  @ApiPropertyOptional({ description: 'Message for table QR codes' })
  @IsString()
  @IsOptional()
  tableQRMessage?: string;
}
