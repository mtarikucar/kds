import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const PASSWORD_COMPLEXITY_REGEX = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
const PASSWORD_COMPLEXITY_MESSAGE =
  'Password must contain at least one lowercase letter, one uppercase letter, and one digit';
// 128 — well above bcrypt's 72-byte truncation, low enough that the
// bcryptjs (JS impl) doesn't burn API CPU on hash work for a hostile
// megabyte payload. Same rationale as LoginDto.
const PASSWORD_MAX_LENGTH = 128;

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254) // RFC 5321
  email: string;
}

export class ResetPasswordDto {
  // Reset tokens are short opaque strings (sha256 hex = 64). Cap at
  // 256 so a megabyte token doesn't slow down the indexed lookup or
  // burn parser time on the way in.
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;

  @ApiProperty({ minimum: 8, maximum: PASSWORD_MAX_LENGTH })
  @IsString()
  @MinLength(8)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_COMPLEXITY_REGEX, { message: PASSWORD_COMPLEXITY_MESSAGE })
  @IsNotEmpty()
  newPassword: string;
}

export class ChangePasswordDto {
  // Cap on currentPassword too — bcrypt.compare runs the same hash
  // work on the submitted side as bcrypt.hash, so a megabyte
  // currentPassword is still a CPU-DoS vector even though it would
  // never match a real hash.
  @ApiProperty({ maximum: PASSWORD_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({ minimum: 8, maximum: PASSWORD_MAX_LENGTH })
  @IsString()
  @MinLength(8)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_COMPLEXITY_REGEX, { message: PASSWORD_COMPLEXITY_MESSAGE })
  @IsNotEmpty()
  newPassword: string;
}
