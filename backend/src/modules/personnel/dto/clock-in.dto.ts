import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ClockInDto {
  // Notes are persisted to Attendance.notes which appears on payroll
  // export and labor audit trail. Cap at 500 — generous for "stuck
  // in traffic, will make it up at end of shift" without leaving the
  // column unbounded.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
