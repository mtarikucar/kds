import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsBoolean, IsArray, IsEmail, Matches } from 'class-validator';
import {
  SUPPORTED_CURRENCIES,
  SupportedCurrency,
} from '../../../common/constants/currencies.const';

export class UpdateTenantSettingsDto {
  @ApiPropertyOptional({
    description: 'Tenant currency',
    enum: SUPPORTED_CURRENCIES,
    example: 'TRY',
  })
  @IsString()
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: SupportedCurrency;

  @ApiPropertyOptional({
    description: 'Store closing time (HH:mm format)',
    example: '23:00',
  })
  @IsString()
  @IsOptional()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'closingTime must be in HH:mm format (e.g., 23:00)',
  })
  closingTime?: string;

  @ApiPropertyOptional({
    description: 'Timezone for the tenant',
    example: 'Europe/Istanbul',
  })
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({
    description: 'Enable automated daily report emails',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  reportEmailEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Email addresses to send reports to',
    example: ['admin@example.com'],
    type: [String],
  })
  @IsArray()
  @IsEmail({}, { each: true })
  @IsOptional()
  reportEmails?: string[];
}
