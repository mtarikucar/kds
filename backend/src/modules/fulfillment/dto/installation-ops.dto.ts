import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class ScheduleInstallationDto {
  @ApiProperty({ example: '2026-06-15T09:00:00.000Z', description: 'ISO-8601 scheduled date/time' })
  @IsDateString({}, { message: 'scheduledFor must be an ISO-8601 date string' })
  scheduledFor: string;

  @ApiProperty({ required: false, description: 'Technician id / handle' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  assignedTo?: string;
}

export class CompleteInstallationDto {
  @ApiProperty({ required: false, description: 'Close-out note appended to the request' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class CancelInstallationDto {
  @ApiProperty({ required: false, description: 'Cancellation reason (audit trail)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
