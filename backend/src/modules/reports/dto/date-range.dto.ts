import { IsDateString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

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
