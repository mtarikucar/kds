import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";

const KIND = ["software", "integration", "capacity", "support"] as const;
const BILLING = ["recurring", "oneTime"] as const;
const STATUS = ["draft", "published", "archived"] as const;

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
}

export class PurchaseAddOnDto {
  @ApiProperty()
  @IsString()
  addOnCode!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;
}
