import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

// Same E.164-ish regex CreateReservationDto + CancelPublicReservationDto
// already use. Phone is matched verbatim against
// reservation.customerPhone — without the DTO this endpoint accepted
// raw query strings of any length (URL strings aren't bounded by the
// body-parser limit; only the front proxy's URL cap helps).
const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

/**
 * Query for GET /public/reservations/:tenantId/lookup.
 *
 * Both fields are equality-matched against indexed columns. The 10/min
 * throttle bounds traffic; the DTO bounds payload shape so a probing
 * attacker can't slow down the DB with megabyte query strings.
 */
export class LookupReservationDto {
  @ApiProperty({ description: 'Customer phone from booking time (E.164-ish)' })
  @IsString()
  @MaxLength(20)
  @Matches(PHONE_REGEX, {
    message: 'phone must be a valid phone number (8-15 digits, optional leading +)',
  })
  phone: string;

  @ApiProperty({ description: 'Reservation number issued at booking time' })
  @IsString()
  @MaxLength(32)
  reservationNumber: string;
}
