import { ApiProperty } from "@nestjs/swagger";
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class SuperAdminLoginDto {
  // Caps mirror iter-43 (auth) / iter-46 (users). Even with the
  // aggressive 5/min throttle on /superadmin/auth/login, bcryptjs
  // processes the FULL submitted password before bcrypt's 72-byte
  // truncation runs — a distributed attack against a megabyte
  // password still amplifies CPU cost. 128 covers any realistic
  // strong password; 254 is RFC 5321 SMTP local+domain max.
  @ApiProperty({ example: "admin@example.com" })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: "securepassword123" })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class SuperAdminLoginResponseDto {
  @ApiProperty()
  requiresTwoFactor: boolean;

  @ApiProperty({ required: false })
  requires2FASetup?: boolean;

  @ApiProperty({ required: false })
  tempToken?: string;

  @ApiProperty({ required: false })
  accessToken?: string;

  @ApiProperty({ required: false })
  refreshToken?: string;

  @ApiProperty({ required: false })
  superAdmin?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}
