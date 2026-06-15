import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from "class-validator";
import { NormalizePhone } from "../../../common/dto/normalize-phone";

// Phone fields are NORMALIZED to E.164 (NormalizePhone) before validation, so
// callers can type any natural format — "0555 123 45 67", "+90 555 123 45 67",
// "(0555) 123-45-67" — and it lands as "+905551234567". The regex then asserts
// the canonical E.164 shape; an unparseable value passes through untouched and
// is rejected with the friendly message.
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
const PHONE_MESSAGE = "Lütfen geçerli bir telefon numarası girin.";
// Iter-85: customer-session token shape. createSession emits
// randomBytes(32).toString('hex') = exactly 64 lower-hex chars.
// Pre-iter-85 the four sessionId fields below used @Length(32, 128)
// which let malformed strings through to the DB lookup. Tight regex
// stops typos / spoofing attempts at the DTO layer.
const SESSION_ID_REGEX = /^[0-9a-f]{64}$/;

export class CreateCustomerDto {
  @ApiProperty({ description: "Customer full name" })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: "Customer phone (E.164 or digits)" })
  @NormalizePhone("TR")
  @IsString()
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
  @MaxLength(20)
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  birthday?: string; // YYYY-MM-DD
}

export class UpdateCustomerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @NormalizePhone("TR")
  @IsOptional()
  @IsString()
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  birthday?: string;
}

// ---- Public controller DTOs ----

export class CreatePublicSessionDto {
  // Iter-79: this endpoint is @Public — anyone on the internet can post
  // to it. Pre-fix the validators were @IsString @Length(1, 64), so
  // garbage strings landed in CustomerSession.tenantId / .tableId
  // without any reality check. Combined with the per-IP throttle being
  // the only gate, an attacker rotating IPs could pump tens of
  // thousands of fake sessions per day onto any guessed (or spoofed
  // non-existent) tenant. @IsUUID forces the shape; service-side
  // existence checks reject unknown rows before the create write fires.
  @ApiProperty()
  @IsUUID()
  tenantId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tableId?: string;
}

export class IdentifyCustomerDto {
  @ApiProperty()
  @IsString()
  @Length(64, 64)
  @Matches(SESSION_ID_REGEX, {
    message: "sessionId must be a 64-char lower-hex string",
  })
  sessionId: string;

  @ApiProperty()
  @NormalizePhone("TR")
  @IsString()
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
  @MaxLength(20)
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

export class SendOTPDto {
  @ApiProperty()
  @NormalizePhone("TR")
  @IsString()
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
  @MaxLength(20)
  phone: string;

  @ApiProperty()
  @IsString()
  @Length(64, 64)
  @Matches(SESSION_ID_REGEX, {
    message: "sessionId must be a 64-char lower-hex string",
  })
  sessionId: string;
}

export class VerifyOTPDto {
  @ApiProperty()
  @NormalizePhone("TR")
  @IsString()
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
  @MaxLength(20)
  phone: string;

  @ApiProperty()
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiProperty()
  @IsString()
  @Length(64, 64)
  @Matches(SESSION_ID_REGEX, {
    message: "sessionId must be a 64-char lower-hex string",
  })
  sessionId: string;
}

export class ApplyReferralCodeDto {
  @ApiProperty()
  @IsString()
  @Length(64, 64)
  @Matches(SESSION_ID_REGEX, {
    message: "sessionId must be a 64-char lower-hex string",
  })
  sessionId: string;

  @ApiProperty()
  @IsString()
  @Length(4, 32)
  @Matches(/^[A-Z0-9]+$/, {
    message: "referralCode must be uppercase alphanumeric",
  })
  referralCode: string;
}
