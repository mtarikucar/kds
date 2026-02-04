import { IsDateString, IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { HeatmapGranularity } from '../enums/analytics.enum';

export class DateRangeDto {
  @ApiPropertyOptional({ description: 'Start date (ISO format)', example: '2025-01-01T00:00:00Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO format)', example: '2025-12-31T23:59:59Z' })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}

export class HeatmapQueryDto extends DateRangeDto {
  @ApiPropertyOptional({
    description: 'Time granularity for aggregation',
    enum: HeatmapGranularity,
    default: HeatmapGranularity.HOURLY
  })
  @IsEnum(HeatmapGranularity)
  @IsOptional()
  granularity?: HeatmapGranularity;
}
