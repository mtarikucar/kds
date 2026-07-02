import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  Max,
  IsObject,
} from "class-validator";
import {
  EmptyStringToNumber,
  StringToBoolean,
} from "../../../common/dto/transforms";

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
  // Must be positive: the slot generator does `currentMinutes += interval`, so
  // 0/negative never advances the loop → the availability request hangs (DoS).
  // 5-minute floor, 4-hour ceiling keeps it a sane reservation granularity.
  @Min(5)
  @Max(240)
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

  @ApiPropertyOptional({
    description:
      'Operating hours per day { monday: { open: "09:00", close: "22:00", closed: false } }',
  })
  @IsOptional()
  @IsObject()
  operatingHours?: Record<
    string,
    { open: string; close: string; closed: boolean }
  >;

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
  // 0 means "unlimited" (the availability check is skipped when falsy); a
  // NEGATIVE value would make `length >= max` always true and block every slot.
  @Min(0)
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

  @ApiPropertyOptional({
    description:
      "Minutes before a confirmed reservation starts that the table auto-flips to RESERVED. Also bounds the upcomingReservation annotation and the POS reservation dialog. 0 disables pre-hold (table only flips on/after start).",
  })
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  holdOffsetMinutes?: number;
}
