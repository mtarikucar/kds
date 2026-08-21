import { ApiProperty } from "@nestjs/swagger";
import {
  IsEmail,
  IsString,
  MinLength,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  Matches,
  IsUUID,
  MaxLength,
} from "class-validator";
import { UserRole } from "../../../common/constants/roles.enum";
import { EmptyStringToUndefined } from "../../../common/dto/transforms";
import { NormalizePhone } from "../../../common/dto/normalize-phone";
import { E164_PATTERN } from "../../../common/phone/e164.const";
import { COUNTRY_PROFILES } from "../../../common/country/country-profile.const";

export class RegisterDto {
  @ApiProperty({ example: "admin@restaurant.com" })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254) // RFC 5321
  email: string;

  // 128-char cap defends against bcryptjs CPU-DoS — see LoginDto.
  // Above bcrypt's 72-byte truncation point so legitimate strong
  // passwords still work.
  @ApiProperty({ example: "Passw0rd!", minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      "Password must contain at least one lowercase letter, one uppercase letter, and one digit",
  })
  password: string;

  @ApiProperty({ example: "John" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: "Doe" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  // Phone is REQUIRED at registration so PayTR checkout (which mandates
  // user_phone) always has a number — without it the buyer hit
  // "buyer.phone should not be empty" at checkout. NormalizePhone()
  // accepts any natural format ("0555 123 45 67", "+90 555 …") and lands it
  // as E.164 ("+905551234567"); the regex rejects anything unparseable.
  // Mirrors CheckoutBuyerDto exactly.
  @ApiProperty({ example: "+905551234567", maxLength: 32 })
  @NormalizePhone()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(E164_PATTERN, {
    message: "Lütfen geçerli bir telefon numarası girin.",
  })
  phone: string;

  @ApiProperty({ enum: UserRole, example: UserRole.ADMIN, required: false })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @ApiProperty({ example: "My Restaurant", required: false })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(120)
  restaurantName?: string;

  @ApiProperty({ example: "tenant-uuid", required: false })
  @EmptyStringToUndefined()
  @IsUUID()
  @IsOptional()
  tenantId?: string;

  // REQUIRED. Before this field existed, no code path ever wrote
  // Tenant.countryCode — every tenant silently landed on the schema
  // default ("TR") with no way to correct it, so an Uzbek café registering
  // today ran on Turkish tax bands and Turkish currency forever. The
  // operator's own choice, not an inference: a Turkish owner opening a
  // café in Uzbekistan has a Turkish phone number, so phone-region
  // inference alone would be wrong. The frontend pre-fills this from the
  // phone's E.164 region as a SUGGESTION only — the operator can change it.
  //
  // Validated against the real COUNTRY_PROFILES keys (not a free string,
  // not the full ISO-3166 list) — a code with no profile would silently
  // resolve to DEFAULT_COUNTRY downstream and mislead the operator into
  // thinking they picked something else. Only join-scenario 2 (an
  // existing tenant) ignores this field; scenario 1 (a new restaurant)
  // is the only path that consumes it.
  @ApiProperty({
    enum: Object.keys(COUNTRY_PROFILES),
    example: "TR",
    description:
      "ISO-3166-1 alpha-2 country the restaurant operates in. Drives tax bands, currency, phone region, tax-id shape and receipt locale — see COUNTRY_PROFILES. Must be one of the platform's supported countries.",
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(Object.keys(COUNTRY_PROFILES))
  countryCode: string;
}
