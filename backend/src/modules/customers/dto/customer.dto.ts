import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

export class CreateCustomerDto {
  @ApiProperty({ description: 'Customer full name' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Customer phone (E.164 or digits)' })
  @IsString()
  @Matches(PHONE_REGEX)
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
  @IsOptional()
  @IsString()
  @Matches(PHONE_REGEX)
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
  @Length(32, 128)
  sessionId: string;

  @ApiProperty()
  @IsString()
  @Matches(PHONE_REGEX)
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
  @IsString()
  @Matches(PHONE_REGEX)
  @MaxLength(20)
  phone: string;

  @ApiProperty()
  @IsString()
  @Length(32, 128)
  sessionId: string;
}

export class VerifyOTPDto {
  @ApiProperty()
  @IsString()
  @Matches(PHONE_REGEX)
  @MaxLength(20)
  phone: string;

  @ApiProperty()
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiProperty()
  @IsString()
  @Length(32, 128)
  sessionId: string;
}

export class ApplyReferralCodeDto {
  @ApiProperty()
  @IsString()
  @Length(32, 128)
  sessionId: string;

  @ApiProperty()
  @IsString()
  @Length(4, 32)
  @Matches(/^[A-Z0-9]+$/, { message: 'referralCode must be uppercase alphanumeric' })
  referralCode: string;
}
