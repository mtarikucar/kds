import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { EmptyStringToUndefined } from '../../../common/dto/transforms';

export class DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'ISO date or datetime', example: '2026-04-01' })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'ISO date or datetime', example: '2026-04-30' })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  // HummyTummy Phase 3 — branch-scoping. Omitting this returns tenant-wide
  // numbers (including null-branch legacy orders); providing it restricts
  // to orders booked against that branch.
  // Format-validate up front: a typo'd id used to silently filter to zero
  // rows ("no data for this period"), now returns 400 with a clear error.
  @ApiPropertyOptional({ description: 'Restrict to a specific branch (UUID)' })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class TopProductsQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'Max products to return (1-100)', example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SingleDateQueryDto {
  @ApiPropertyOptional({ description: 'Target date (ISO)', example: '2026-04-15' })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ description: 'Restrict to a specific branch (UUID)' })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
