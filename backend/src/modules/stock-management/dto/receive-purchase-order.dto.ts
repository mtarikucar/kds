import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, Min, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReceiveLineItemDto {
  @ApiProperty({ description: 'Purchase order item ID' })
  @IsString()
  purchaseOrderItemId: string;

  @ApiProperty({ description: 'Quantity received', minimum: 0 })
  @IsNumber()
  @Min(0)
  quantityReceived: number;

  @ApiPropertyOptional({ description: 'Batch number' })
  @IsString()
  @IsOptional()
  batchNumber?: string;

  @ApiPropertyOptional({ description: 'Expiry date for this batch' })
  @IsDateString()
  @IsOptional()
  expiryDate?: string;
}

export class ReceivePurchaseOrderDto {
  @ApiProperty({ type: [ReceiveLineItemDto], description: 'Items being received' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineItemDto)
  items: ReceiveLineItemDto[];

  @ApiPropertyOptional({ description: 'Notes about the receiving' })
  @IsString()
  @IsOptional()
  notes?: string;
}
