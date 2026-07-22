import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsInt,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsIn,
  Min,
  Max,
  IsEmail,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { NormalizePhone } from "../../../common/dto/normalize-phone";

// Same E.164 contract as the public DTO — phone is NORMALIZED first, then the
// regex asserts canonical form. Staff bookings accept any natural typed format.
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
const PHONE_MESSAGE = "Lütfen geçerli bir telefon numarası girin.";

/**
 * Staff-created reservation (phone booking or walk-in). Unlike the public DTO
 * there is NO @AtLeastOneOf(email|phone): a WALKIN needs no contact at all, and
 * the frontend (Lane C) enforces "at least one for PHONE". The service reuses
 * the same conflict-checked transactional core as the public create but skips
 * the requireApproval / advance-window / closed-day gates (staff judgment).
 */
export class CreateStaffReservationDto {
  @ApiProperty({ description: "Reservation date", example: "2026-03-01" })
  @IsDateString()
  date: string;

  @ApiProperty({ description: "Start time", example: "19:00" })
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: "Start time must be in HH:mm format",
  })
  startTime: string;

  // Optional — defaults to startTime + settings.defaultDuration in the service.
  @ApiPropertyOptional({ description: "End time", example: "20:30" })
  @IsOptional()
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: "End time must be in HH:mm format",
  })
  endTime?: string;

  @ApiProperty({ description: "Number of guests", example: 4 })
  @IsInt()
  @Min(1)
  @Max(100)
  guestCount: number;

  @ApiProperty({ description: "Customer name", example: "John Doe" })
  @IsString()
  @MaxLength(100)
  customerName: string;

  @ApiPropertyOptional({
    description: "Customer phone (E.164 or digits)",
    example: "+905551234567",
  })
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

  @ApiPropertyOptional({ description: "Customer email" })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  customerEmail?: string;

  @ApiPropertyOptional({ description: "Customer-visible notes" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: "Internal admin-only notes" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  adminNotes?: string;

  @ApiPropertyOptional({ description: "Table ID" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tableId?: string;

  @ApiPropertyOptional({ description: "Branch ID (multi-branch tenants)" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  branchId?: string;

  // Booking origin. PHONE → customer gets the confirmation notification;
  // WALKIN → no customer notification. Defaults to PHONE when omitted.
  @ApiPropertyOptional({
    description: "Booking source",
    enum: ["PHONE", "WALKIN"],
    default: "PHONE",
  })
  @IsOptional()
  @IsIn(["PHONE", "WALKIN"])
  source?: "PHONE" | "WALKIN" = "PHONE";

  // Walk-in convenience: create the reservation and immediately seat it
  // (table → OCCUPIED) via the same guarded claim seat() uses. Requires tableId.
  @ApiPropertyOptional({
    description: "Create then immediately seat (walk-in). Requires tableId.",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  autoSeat?: boolean;
}
