import { IsString, IsNotEmpty, IsOptional, IsEmail, IsNumber, Min, Max, MinLength } from 'class-validator';

export class ConvertLeadDto {
  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsString()
  offerId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(99999999.99)
  commissionAmount?: number;

  @IsString()
  @IsNotEmpty()
  tenantName: string;

  @IsEmail()
  adminEmail: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  adminPassword: string;

  @IsString()
  @IsNotEmpty()
  adminFirstName: string;

  @IsString()
  @IsNotEmpty()
  adminLastName: string;
}
