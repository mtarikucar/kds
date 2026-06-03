import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { UserRole } from "../../../common/constants/roles.enum";
import { EmptyStringToUndefined } from "../../../common/dto/transforms";

// Caps replicated from CreateUserDto / iter-43 — see comment there.
const PASSWORD_MAX_LENGTH = 128;
const EMAIL_MAX_LENGTH = 254;
const NAME_MAX_LENGTH = 100;

/**
 * Status transitions deliberately live on dedicated endpoints
 * (/approve, /reject, /reactivate, DELETE /:id). This DTO intentionally
 * does not accept `status` so mass-assignment cannot flip an INACTIVE
 * user back to ACTIVE or vice-versa through the generic update path.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({ example: "user@restaurant.com" })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email?: string;

  @ApiPropertyOptional({ example: "Passw0rd!" })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      "Password must contain at least one lowercase letter, one uppercase letter, and one digit",
  })
  password?: string;

  @ApiPropertyOptional({ example: "John" })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX_LENGTH)
  firstName?: string;

  @ApiPropertyOptional({ example: "Doe" })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX_LENGTH)
  lastName?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
