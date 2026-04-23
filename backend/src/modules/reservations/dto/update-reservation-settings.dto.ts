import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min, Max, IsObject } from 'class-validator';
import { EmptyStringToNumber, StringToBoolean } from '../../../common/dto/transforms';

export class UpdateReservationSettingsDto {
  @ApiPropertyOptional()
  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional()
  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  requireApproval?: boolean;

  @ApiPropertyOptional()
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  timeSlotInterval?: number;

  @ApiPropertyOptional()
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(0)
  minAdvanceBooking?: number;

  @ApiPropertyOptional()
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  maxAdvanceDays?: number;

  @ApiPropertyOptional()
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(15)
  defaultDuration?: number;

  @ApiPropertyOptional({ description: 'Operating hours per day { monday: { open: "09:00", close: "22:00", closed: false } }' })
  @IsOptional()
  @IsObject()
  operatingHours?: Record<string, { open: string; close: string; closed: boolean }>;

  @ApiPropertyOptional()
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxGuestsPerReservation?: number;

  @ApiPropertyOptional()
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  maxReservationsPerSlot?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bannerImageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bannerTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bannerDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customMessage?: string;

  @ApiPropertyOptional()
  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  allowCancellation?: boolean;

  @ApiPropertyOptional()
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(0)
  cancellationDeadline?: number;
}
