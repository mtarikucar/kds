import { IsString, IsNotEmpty, IsEmail, IsEnum, IsOptional } from 'class-validator';

export enum MarketingUserRole {
  SALES_MANAGER = 'SALES_MANAGER',
  SALES_REP = 'SALES_REP',
}

export class CreateMarketingUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
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
