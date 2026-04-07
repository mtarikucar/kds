import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSalesInvoiceDto {
  @ApiPropertyOptional() @IsString() @IsOptional() orderId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() customerName?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() customerTaxId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() customerTaxOffice?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() customerPhone?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() customerEmail?: string;
}

export class InvoiceQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() page?: number;
  @IsOptional() limit?: number;
}
