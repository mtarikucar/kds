import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class ClockInDto {
  // Free-text note persisted to Attendance.notes (e.g. "stuck in traffic,
  // will make it up at end of shift"). Capped at 500 to keep the column
  // bounded. Note: there is no payroll/wage rail in the system — worked and
  // overtime minutes are attendance/scheduling metrics only and are not
  // converted to compensation anywhere.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
