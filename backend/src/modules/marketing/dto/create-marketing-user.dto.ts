import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsEnum,
  IsOptional,
  Matches,
  MinLength,
} from 'class-validator';

export enum MarketingUserRole {
  SALES_MANAGER = 'SALES_MANAGER',
  SALES_REP = 'SALES_REP',
}

export class CreateMarketingUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Password must contain at least one lowercase letter, one uppercase letter, and one digit',
  })
  password: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsEnum(MarketingUserRole)
  role: MarketingUserRole;
}
