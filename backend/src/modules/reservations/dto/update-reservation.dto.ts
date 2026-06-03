import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsInt,
  IsOptional,
  IsDateString,
  Min,
  Max,
  IsEmail,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { EmptyStringToNumber } from "../../../common/dto/transforms";

// E.164-ish: 8-15 digits, optional leading +. Mirrors CreateReservationDto
// so an UPDATE can't smuggle a junk phone into reservation.customerPhone
// (which the public lookup endpoint reads as the auth signal).
const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

export class UpdateReservationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: "Start time must be in HH:mm format",
  })
  startTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: "End time must be in HH:mm format",
  })
  endTime?: string;

  @ApiPropertyOptional()
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  guestCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf(
    (o) =>
      o.customerPhone !== undefined &&
      o.customerPhone !== null &&
      o.customerPhone !== "",
  )
  @IsString()
  @MaxLength(20)
  @Matches(PHONE_REGEX, {
    message:
      "customerPhone must be a valid phone number (8-15 digits, optional leading +)",
  })
  customerPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  customerEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tableId?: string;
}

export class RejectReservationDto {
  @ApiPropertyOptional({ description: "Reason for rejection" })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
