import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min, Max } from 'class-validator';

export class UpdateReservationSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireApproval?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  timeSlotInterval?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  minAdvanceBooking?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  maxAdvanceDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(15)
  defaultDuration?: number;

  @ApiPropertyOptional()
  @IsOptional()
  operatingHours?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxGuestsPerReservation?: number;

  @ApiPropertyOptional()
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
  @IsOptional()
  @IsBoolean()
  allowCancellation?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  cancellationDeadline?: number;
}
