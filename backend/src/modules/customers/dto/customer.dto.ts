import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
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
  @ApiProperty()
  @IsString()
  @Length(1, 64)
  tenantId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 64)
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
