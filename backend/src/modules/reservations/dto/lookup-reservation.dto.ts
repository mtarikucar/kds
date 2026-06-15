import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MaxLength } from "class-validator";
import { NormalizePhone } from "../../../common/dto/normalize-phone";

// Phone is NORMALIZED to E.164 (NormalizePhone) before validation, mirroring
// CreateReservationDto + CancelPublicReservationDto so the same natural
// formats the booker typed resolve to the canonical value stored on
// reservation.customerPhone. Without the DTO this endpoint accepted raw
// query strings of any length (URL strings aren't bounded by the body-parser
// limit; only the front proxy's URL cap helps).
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
const PHONE_MESSAGE = "Lütfen geçerli bir telefon numarası girin.";

/**
 * Query for GET /public/reservations/:tenantId/lookup.
 *
 * Both fields are equality-matched against indexed columns. The 10/min
 * throttle bounds traffic; the DTO bounds payload shape so a probing
 * attacker can't slow down the DB with megabyte query strings.
 */
export class LookupReservationDto {
  @ApiProperty({ description: "Customer phone from booking time (E.164-ish)" })
  @NormalizePhone("TR")
  @IsString()
  @MaxLength(20)
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
  phone: string;

  @ApiProperty({ description: "Reservation number issued at booking time" })
  @IsString()
  @MaxLength(32)
  reservationNumber: string;
}
