import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsDateString } from 'class-validator';

export class ScheduleQueryDto {
  @ApiPropertyOptional({ description: 'Start of week (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  weekStart?: string;
}
