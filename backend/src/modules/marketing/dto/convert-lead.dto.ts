import { IsString, IsNotEmpty, IsOptional, IsEmail } from 'class-validator';

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
  adminPassword: string;

  @IsString()
  @IsNotEmpty()
  adminFirstName: string;

  @IsString()
  @IsNotEmpty()
  adminLastName: string;
}
