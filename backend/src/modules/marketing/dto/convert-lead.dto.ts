import { IsString, IsNotEmpty, IsOptional, IsEmail, IsUUID } from 'class-validator';

/**
 * Admin password is deliberately NOT part of this DTO. The conversion
 * endpoint generates a random password for the new tenant admin and
 * emails them a welcome message + reset link — sales staff must never
 * hold plaintext credentials for customer accounts.
 */
export class ConvertLeadDto {
  @IsOptional()
  @IsUUID()
  planId?: string;

  @IsOptional()
  @IsUUID()
  offerId?: string;

  @IsString()
  @IsNotEmpty()
  tenantName: string;

  @IsEmail()
  adminEmail: string;

  @IsString()
  @IsNotEmpty()
  adminFirstName: string;

  @IsString()
  @IsNotEmpty()
  adminLastName: string;
}
