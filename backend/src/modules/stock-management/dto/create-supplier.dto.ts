import { IsString, IsOptional, IsEmail, IsBoolean, IsNumber, Min, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';

export class SupplierStockItemDto {
  @ApiProperty({ description: 'Stock item ID' })
  @IsString()
  stockItemId: string;

  @ApiPropertyOptional({ description: 'Supplier-specific SKU' })
  @IsString()
  @IsOptional()
  supplierSku?: string;

  @ApiProperty({ description: 'Unit price from this supplier', minimum: 0 })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional({ description: 'Is this the preferred supplier for this item' })
  @IsBoolean()
  @IsOptional()
  isPreferred?: boolean;
}

export class CreateSupplierDto {
  @ApiProperty({ description: 'Supplier name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Contact person name' })
  @IsString()
  @IsOptional()
  contactName?: string;

  @ApiPropertyOptional({ description: 'Supplier email' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'Supplier phone' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ description: 'Supplier address' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ description: 'Payment terms (e.g. Net 30, COD)' })
  @IsString()
  @IsOptional()
  paymentTerms?: string;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {
  @ApiPropertyOptional({ description: 'Whether supplier is active' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
