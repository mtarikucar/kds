import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, Min, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PurchaseOrderItemDto {
  @ApiProperty({ description: 'Stock item ID' })
  @IsString()
  stockItemId: string;

  @ApiProperty({ description: 'Quantity to order', minimum: 0 })
  @IsNumber()
  @Min(0)
  quantityOrdered: number;

  @ApiProperty({ description: 'Unit price', minimum: 0 })
  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class CreatePurchaseOrderDto {
  @ApiProperty({ description: 'Supplier ID' })
  @IsString()
  supplierId: string;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'Expected delivery date' })
  @IsDateString()
  @IsOptional()
  expectedDate?: string;

  @ApiProperty({ type: [PurchaseOrderItemDto], description: 'Order line items' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];
}
