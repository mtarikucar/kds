import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, IsNotEmpty, MaxLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "admin@restaurant.com" })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254) // RFC 5321 SMTP local+domain limit
  email: string;

  // bcryptjs (the JS impl in use) processes the full input string
  // before bcrypt's internal 72-byte truncation kicks in, so a
  // megabyte-long password takes seconds to hash. With the 5/min
  // login throttle a single attacker could still burn 5s of API
  // CPU per minute on hash work alone. Cap defensively.
  @ApiProperty({ example: "password123" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
