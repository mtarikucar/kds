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
import { NormalizePhone } from "../../../common/dto/normalize-phone";

// Phone is NORMALIZED to E.164 (NormalizePhone) before validation. Mirrors
// CreateReservationDto so an UPDATE can't smuggle a junk phone into
// reservation.customerPhone (which the public lookup endpoint reads as the
// auth signal); a natural format normalizes to canonical E.164, an
// unparseable value passes through and is rejected.
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
const PHONE_MESSAGE = "Lütfen geçerli bir telefon numarası girin.";

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
  @NormalizePhone("TR")
  @IsOptional()
  @ValidateIf(
    (o) =>
      o.customerPhone !== undefined &&
      o.customerPhone !== null &&
      o.customerPhone !== "",
  )
  @IsString()
  @MaxLength(20)
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
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
