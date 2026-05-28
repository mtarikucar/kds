import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * iter-73 — branches controller previously accepted inline @Body()
 * types and ValidationPipe couldn't fire. Convert to DTO classes so:
 *
 *   - name / code / timezone get @MaxLength caps (Branch.name and
 *     Branch.code are Postgres TEXT — no implicit ceiling; a
 *     bug-driven or compromised admin write would otherwise persist
 *     a multi-MB blob);
 *   - timezone is validated against the IANA database (same Intl-
 *     DateTimeFormat trick iter-45 added to tenant settings) so a
 *     typo'd "Eüróp/Istanbul" doesn't land in the column and break
 *     every per-branch midnight computation that depends on it;
 *   - status uses an enum allowlist instead of the service-side
 *     manual `includes()` check, which couldn't fire when the body
 *     was an inline type;
 *   - address stays an object — Branch.address is JSONB and we
 *     intentionally don't validate the shape (single/double-line,
 *     country-specific) until the multi-country chain feature lands.
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

export class CreateBranchDto {
  @ApiPropertyOptional({ description: 'Display name shown in admin UI', example: 'Bağdat Caddesi' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Free-form short code (e.g. "IST-01")' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  @ApiPropertyOptional({ description: 'IANA timezone for this branch', example: 'Europe/Istanbul' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Validate(IsIanaTimezoneConstraint)
  timezone?: string;

  @ApiPropertyOptional({ description: 'Free-form address blob (JSONB)' })
  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;
}

export class UpdateBranchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Validate(IsIanaTimezoneConstraint)
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['active', 'suspended', 'archived'] })
  @IsOptional()
  @IsIn(['active', 'suspended', 'archived'])
  status?: 'active' | 'suspended' | 'archived';
}
