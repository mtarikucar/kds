import { IsString, IsOptional, IsNumber, IsEnum, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WasteReason } from '../../../common/constants/stock-management.enum';

export class CreateWasteLogDto {
  @ApiProperty({ description: 'Stock item ID' })
  @IsString()
  stockItemId: string;

  @ApiProperty({ description: 'Quantity wasted', minimum: 0 })
  @IsNumber()
  @Min(0)
  quantity: number;

  @ApiProperty({ enum: WasteReason, description: 'Reason for waste' })
  @IsEnum(WasteReason)
  reason: WasteReason;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}
