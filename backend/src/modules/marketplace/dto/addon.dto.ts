import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";

// v3.3.0 à-la-carte vocabulary. Shape validation stops at "is this one of the
// allowed strings"; the semantic invariants (a credit pack must declare
// creditKind/creditUnits, an integration must actually grant integration.*,
// a published row must cost more than zero) live in catalog-validation.ts so
// the seed, the data migration and the admin API all check the same rules.
const KIND = [
  "license",
  "module",
  "integration",
  "capacity",
  "credit",
  "service",
] as const;
const BILLING = ["annual", "oneTime"] as const;
const STATUS = ["draft", "published", "archived"] as const;
const CREDIT_KIND = ["PHOTO", "VIDEO", "MODEL3D", "SMS"] as const;

export class CreateAddOnDto {
  // Code is the immutable handle other systems reference. ASCII letters,
  // digits, dashes, underscores — anything else risks breaking URLs and
  // dependency strings ("plan:PRO" delimits on colons).
  @ApiProperty({ example: "kds_extra_screen" })
  @IsString()
  @Matches(/^[a-z0-9_]+$/, {
    message: "lowercase letters, digits, underscores only",
  })
  code!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: KIND })
  @IsIn(KIND as any)
  kind!: (typeof KIND)[number];

  @ApiProperty({ enum: BILLING, default: "recurring" })
  @IsIn(BILLING as any)
  billing!: (typeof BILLING)[number];

  // priceCents in monetary minor units (kuruş for TRY) — prevents float drift
  // on tax calculations.
  @ApiProperty({ example: 4900 })
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  priceCents!: number;

  @ApiPropertyOptional({ default: "TRY" })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: "currency must be a 3-letter ISO code" })
  currency?: string;

  // grants is free-form JSON shaped per AddOnGrants. The projector validates
  // keys at apply time; we let unknown keys through here so the schema is
  // open to future expansion without code churn.
  @ApiProperty({
    example: { "limit.kdsScreens": 1, "feature.advancedReports": true },
  })
  @IsObject()
  grants!: Record<string, boolean | number | string[]>;

  @ApiPropertyOptional({ type: [String], default: [] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deps?: string[];

  @ApiPropertyOptional({ enum: STATUS, default: "draft" })
  @IsOptional()
  @IsIn(STATUS as any)
  status?: (typeof STATUS)[number];

  @ApiPropertyOptional({
    default: true,
    description:
      "Whether an active licence is required to buy AND use this product. False for the licence itself, credit packs and one-time services.",
  })
  @IsOptional()
  @IsBoolean()
  requiresLicense?: boolean;

  @ApiPropertyOptional({ enum: CREDIT_KIND })
  @IsOptional()
  @IsIn(CREDIT_KIND as any)
  creditKind?: (typeof CREDIT_KIND)[number];

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  creditUnits?: number;

  @ApiPropertyOptional({ description: "Capacity purchase ceiling per tenant." })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxQuantity?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({
    description:
      "Localized copy: { tr: { name, description }, en: {...}, ar, ru, uz }. Lives in the DB so shipping a product needs no frontend release.",
  })
  @IsOptional()
  @IsObject()
  i18n?: Record<string, { name?: string; description?: string }>;

  @ApiPropertyOptional({ example: 0.1, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  commissionRate?: number;
}

export class UpdateAddOnDto {
  // Code is intentionally NOT updatable — other rows refer to it by string.
  // Operationally this means "make a new code if you want a new shape".
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: KIND })
  @IsOptional()
  @IsIn(KIND as any)
  kind?: (typeof KIND)[number];

  @ApiPropertyOptional({ enum: BILLING })
  @IsOptional()
  @IsIn(BILLING as any)
  billing?: (typeof BILLING)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: "currency must be a 3-letter ISO code" })
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  grants?: Record<string, boolean | number | string[]>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deps?: string[];

  @ApiPropertyOptional({ enum: STATUS })
  @IsOptional()
  @IsIn(STATUS as any)
  status?: (typeof STATUS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresLicense?: boolean;

  @ApiPropertyOptional({ enum: CREDIT_KIND })
  @IsOptional()
  @IsIn(CREDIT_KIND as any)
  creditKind?: (typeof CREDIT_KIND)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  creditUnits?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxQuantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  i18n?: Record<string, { name?: string; description?: string }>;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  commissionRate?: number;
}
