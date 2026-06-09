import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Caps mirror iter-43 (auth) / iter-46 (users) / iter-47 (superadmin).
// bcryptjs (the JS impl in use) processes the FULL submitted
// password before bcrypt's 72-byte internal truncation, so any
// password-handling auth surface needs the 128-char cap to keep
// distributed CPU-DoS bounded. Marketing is the third auth realm.
export class MarketingLoginDto {
  @IsEmail()
  @MaxLength(254) // RFC 5321
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
