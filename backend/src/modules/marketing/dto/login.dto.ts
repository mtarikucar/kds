import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class MarketingLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
