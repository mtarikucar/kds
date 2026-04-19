import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'ISO date or datetime', example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'ISO date or datetime', example: '2026-04-30' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
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
  @IsOptional()
  @IsDateString()
  date?: string;
}
