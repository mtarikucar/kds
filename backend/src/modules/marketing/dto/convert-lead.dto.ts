import { IsString, IsNotEmpty, IsOptional, IsEmail, MinLength } from 'class-validator';

export class ConvertLeadDto {
  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsString()
  offerId?: string;

  @IsString()
  @IsNotEmpty()
  tenantName: string;

  @IsEmail()
  adminEmail: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  adminPassword: string;

  @IsString()
  @IsNotEmpty()
  adminFirstName: string;

  @IsString()
  @IsNotEmpty()
  adminLastName: string;
}
