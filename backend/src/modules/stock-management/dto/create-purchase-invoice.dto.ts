import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreatePurchaseInvoiceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @ApiPropertyOptional({ description: "PurchaseOrder to 3-way match against" })
  @IsUUID()
  @IsOptional()
  purchaseOrderId?: string;

  @ApiProperty({ description: "Vendor invoice number" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  invoiceNumber: string;

  @ApiProperty({ example: "2026-06-01" })
  @IsDateString()
  invoiceDate: string;

  @ApiProperty({ description: "Goods net (excl. VAT)", minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  subtotal: number;

  @ApiProperty({ description: "Deductible input VAT (indirilecek KDV)", minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  taxAmount: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
