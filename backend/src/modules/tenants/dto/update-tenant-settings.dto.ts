import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsBoolean, IsArray, IsEmail, Matches, IsNumber, Min, Max, MaxLength, IsUrl } from 'class-validator';
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

  // Location settings for QR menu security
  @ApiPropertyOptional({
    description: 'Restaurant latitude coordinate',
    example: 40.7128,
  })
  @IsNumber()
  @IsOptional()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({
    description: 'Restaurant longitude coordinate',
    example: -74.0060,
  })
  @IsNumber()
  @IsOptional()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({
    description: 'Maximum allowed distance in meters for customer orders',
    example: 100,
    default: 100,
  })
  @IsNumber()
  @IsOptional()
  @Min(10)
  @Max(1000)
  locationRadius?: number;

  // WiFi settings
  @ApiPropertyOptional({
    description: 'WiFi network name (SSID)',
    example: 'Restaurant-Guest',
    maxLength: 64,
  })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  wifiSsid?: string;

  @ApiPropertyOptional({
    description: 'WiFi password',
    example: 'welcome123',
    maxLength: 128,
  })
  @IsString()
  @IsOptional()
  @MaxLength(128)
  wifiPassword?: string;

  // Social media links
  @ApiPropertyOptional({
    description: 'Instagram username or URL',
    example: 'restaurant_official',
    maxLength: 255,
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  socialInstagram?: string;

  @ApiPropertyOptional({
    description: 'Facebook page URL',
    example: 'https://facebook.com/restaurant',
    maxLength: 255,
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  socialFacebook?: string;

  @ApiPropertyOptional({
    description: 'Twitter/X username or URL',
    example: 'restaurant_x',
    maxLength: 255,
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  socialTwitter?: string;

  @ApiPropertyOptional({
    description: 'TikTok username or URL',
    example: 'restaurant_tiktok',
    maxLength: 255,
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  socialTiktok?: string;

  @ApiPropertyOptional({
    description: 'YouTube channel URL',
    example: 'https://youtube.com/@restaurant',
    maxLength: 255,
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  socialYoutube?: string;

  @ApiPropertyOptional({
    description: 'WhatsApp business number',
    example: '+905551234567',
    maxLength: 20,
  })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  socialWhatsapp?: string;
}
