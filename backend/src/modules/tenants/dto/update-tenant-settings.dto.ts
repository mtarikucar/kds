import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Custom validator that accepts only IANA-named timezones (e.g.
 * "Europe/Istanbul", "America/New_York"). The earlier @IsString gate
 * let "/etc/passwd" or any garbage land in the DB and silently break
 * downstream display; the z-report scheduler is fail-soft on invalid
 * tz but the persisted bad value is still poor UX.
 *
 * Node 18+ exposes Intl.DateTimeFormat with timeZone option — it
 * throws RangeError on unknown zones, which we treat as the
 * rejection signal. Cheaper than maintaining our own allowlist.
 */
@ValidatorConstraint({ name: 'isIanaTimezone', async: false })
class IsIanaTimezoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || !value) return false;
    try {
      // eslint-disable-next-line no-new
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }
  defaultMessage(): string {
    return 'timezone must be a valid IANA timezone (e.g. "Europe/Istanbul")';
  }
}
import {
  SUPPORTED_CURRENCIES,
  SupportedCurrency,
} from '../../../common/constants/currencies.const';
import { RESERVED_SUBDOMAINS, SUBDOMAIN_REGEX } from '../../../common/constants/subdomain.const';
import { EmptyStringToUndefined } from '../../../common/dto/transforms';

export class UpdateTenantSettingsDto {
  @ApiPropertyOptional({
    description: 'Custom subdomain for QR menu URL (Pro feature)',
    example: 'my-restaurant',
  })
  @EmptyStringToUndefined()
  @ValidateIf((o) => o.subdomain !== null)
  @IsString()
  @IsOptional()
  @MinLength(3, {
    message: 'Subdomain must be at least 3 characters',
  })
  @MaxLength(63)
  @Matches(SUBDOMAIN_REGEX, {
    message:
      'Subdomain must contain only lowercase letters, numbers, and hyphens (cannot start or end with hyphen)',
  })
  @IsNotIn(RESERVED_SUBDOMAINS, {
    message: 'This subdomain is reserved and cannot be used',
  })
  subdomain?: string | null;

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
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'closingTime must be in HH:mm format (e.g., 23:00)',
  })
  closingTime?: string;

  @ApiPropertyOptional({
    description: 'IANA timezone for the tenant (e.g. "Europe/Istanbul")',
    example: 'Europe/Istanbul',
  })
  @IsString()
  @IsOptional()
  @Validate(IsIanaTimezoneConstraint)
  timezone?: string;

  @ApiPropertyOptional({
    description: 'Enable automated daily report emails',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  reportEmailEnabled?: boolean;

  // 20 covers the realistic "CC the whole leadership team" case while
  // bounding the fan-out of the Z-report scheduler, which sends to
  // every address in this list at the tenant's closing time. Without
  // a cap, an admin could land a 10k-email list that turns into 10k
  // SMTP sends per closing window — spam-amplification + provider
  // cost / rate-limit risk.
  @ApiPropertyOptional({
    description: 'Email addresses to send reports to (max 20 recipients)',
    example: ['admin@example.com'],
    type: [String],
    maxItems: 20,
  })
  @IsArray()
  @ArrayMaxSize(20)
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

  @ApiPropertyOptional({
    description:
      'Turkish tax identifier: 10-digit Vergi No (corporate) or 11-digit TC Kimlik No (individual). Surfaced on KDV-compliant invoices. Send `null` to clear.',
    example: '1234567890',
    maxLength: 11,
  })
  @EmptyStringToUndefined()
  @ValidateIf((o) => o.taxId !== null)
  @IsString()
  @IsOptional()
  @Matches(/^\d{10,11}$/, {
    message: 'taxId must be 10 digits (Vergi No) or 11 digits (TC Kimlik No)',
  })
  taxId?: string | null;
}
