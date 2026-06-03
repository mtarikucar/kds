import {
  IsString,
  IsOptional,
  IsEmail,
  MinLength,
  Matches,
  MaxLength,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { EmptyStringToUndefined } from "../../../common/dto/transforms";

// Caps mirror auth + create-user DTOs (iter-43 / iter-46) so every
// password-shaped field on the API surface is bounded against the
// bcryptjs CPU-DoS — see auth/dto/login.dto.ts for the rationale.
const PASSWORD_MAX_LENGTH = 128;
const EMAIL_MAX_LENGTH = 254;
const NAME_MAX_LENGTH = 100;

export class UpdateProfileDto {
  @ApiProperty({ example: "John", required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(NAME_MAX_LENGTH)
  firstName?: string;

  @ApiProperty({ example: "Doe", required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(NAME_MAX_LENGTH)
  lastName?: string;

  // E.164 max is 15 digits + optional '+'. Cap at 20 for headroom.
  @ApiProperty({ example: "+1234567890", required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: "Phone number must be in valid international format",
  })
  phone?: string;
}

export class UpdateEmailDto {
  @ApiProperty({ example: "newemail@example.com" })
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string;

  // currentPassword goes through bcrypt.compare on the auth path,
  // which runs the same CPU work as bcrypt.hash on the submitted
  // side — so a megabyte currentPassword is a CPU-DoS vector even
  // though it would never match a real hash. Same load-bearing cap
  // iter-43 added on ChangePasswordDto.currentPassword.
  @ApiProperty({ example: "CurrentPassword123!" })
  @IsString()
  @MinLength(8)
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;
}
