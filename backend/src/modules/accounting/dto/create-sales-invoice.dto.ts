import {
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Overrides for the invoice being generated from an order. All optional —
 * each field falls back to the order's own value when absent.
 *
 * Caps are sized for Turkish e-fatura: customerTaxId is exactly 10 (legal
 * entity VKN) or 11 (individual TCKN) digits — anything else would be
 * rejected by Foriba/Parasut downstream. We validate format here so the
 * operator sees the error at write time, not after sync round-trip.
 */
export class CreateSalesInvoiceDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(64) orderId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(200) customerName?: string;

  @ApiPropertyOptional({ description: 'TR VKN (10 digits) or TCKN (11 digits)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{10}(\d)?$/, {
    message: 'customerTaxId must be 10 (VKN) or 11 (TCKN) digits',
  })
  customerTaxId?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(120) customerTaxOffice?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(20) customerPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) customerEmail?: string;
}

/**
 * Query for GET /accounting/invoices. Without validators, the previous
 * shape accepted ?limit=10_000_000 and ?search=<10MB blob> straight
 * through to a paginated findMany — the body-parser cap was the only
 * thing standing between an admin (or hijacked admin session) and an
 * O(N) full-table scan. Pin everything.
 */
export class InvoiceQueryDto {
  @IsOptional() @IsString() @MaxLength(32) status?: string;

  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;

  @IsOptional() @IsString() @MaxLength(200) search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // Hard cap at 200 — UI defaults to 20, an export script can ask
  // for the max, but nothing legitimately needs more in one round trip.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
