import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Transform, Type } from "class-transformer";

export class ComboGroupItemDto {
  @ApiProperty({ example: "component-product-uuid" })
  @IsUUID()
  componentProductId: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  quantity?: number;

  @ApiPropertyOptional({
    example: 10,
    default: 0,
    description: "± combo price",
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-10_000)
  @Max(10_000)
  @IsOptional()
  priceDelta?: number;

  @ApiPropertyOptional({ example: false, default: false })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;
}

export class ComboGroupDto {
  @ApiProperty({ example: "İçeceğini Seç" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: "İçecek" })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsInt()
  @Min(0)
  @Max(20)
  @IsOptional()
  minSelect?: number;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsInt()
  @Min(1)
  @Max(20)
  @IsOptional()
  maxSelect?: number;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;

  @ApiProperty({ type: [ComboGroupItemDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ComboGroupItemDto)
  items: ComboGroupItemDto[];
}

// http(s):// for vendor images, or `/` for self-hosted (landing/public assets).
// Blocks `javascript:` / `data:` / `vbscript:` — the legacy `image` column lands
// straight into the public QR menu's <img src>; browsers ignore `javascript:`
// on <img> tags but a `data:` URL big enough to qualify as a page is
// indistinguishable from a stored-XSS payload to downstream consumers.
const PRODUCT_IMAGE_URL_REGEX = /^(https?:\/\/|\/)/;

export class CreateProductDto {
  @ApiProperty({ example: "Grilled Chicken" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  // Description is Postgres TEXT — no implicit ceiling. 5,000 is roomy for
  // long-form menu copy without letting a bug-driven write seed a multi-MB row.
  @ApiProperty({
    example: "Tender grilled chicken with herbs",
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({
    description: 'Customer-facing "içindekiler" (contents/ingredients)',
    example: "Dana kıyma, soğan, domates, biber, baharatlar",
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  ingredients?: string;

  // Schema is Decimal(10, 2) — anything above 99,999,999.99 surfaces as a 500
  // from Postgres. 10,000,000 mirrors the payment-amount cap (iter-42); any
  // realistic menu item is several orders below.
  @ApiProperty({ example: 12.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  price: number;

  // Unit COST (what it costs to make/buy), distinct from the retail `price`.
  // Feeds at-cost inventory valuation + gross margin for products without a
  // recipe. Optional — unset means "no cost basis yet".
  @ApiProperty({ example: 6.5, required: false })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  @IsOptional()
  costPrice?: number;

  @ApiProperty({ example: "https://example.com/image.jpg", required: false })
  // Treat "" / whitespace as "no image" — @IsOptional only skips null/undefined,
  // so without this an empty string (routinely sent by the editor form on a
  // product that has no legacy image) would hit @Matches and 400.
  @Transform(({ value }) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  )
  @IsString()
  @IsOptional()
  @MaxLength(2048)
  @Matches(PRODUCT_IMAGE_URL_REGEX, {
    message: "image must be an absolute http(s) URL or a `/`-rooted path",
  })
  image?: string;

  @ApiProperty({ example: true, default: true, required: false })
  @IsBoolean()
  @IsOptional()
  isAvailable?: boolean;

  @ApiProperty({ example: false, default: false, required: false })
  @IsBoolean()
  @IsOptional()
  stockTracked?: boolean;

  // v2.8.98 — was @IsInt(); the column is now Decimal(10, 3) so
  // fractional units (kg cuts, pours) are accepted. The numeric range
  // cap stays at 1M since the database max is 9,999,999.999.
  @ApiProperty({ example: 0, default: 0, required: false })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000)
  @IsOptional()
  currentStock?: number;

  @ApiProperty({ example: "category-uuid" })
  @IsUUID()
  categoryId: string;

  // Hard cap on imageIds so a malicious / buggy client can't trigger an
  // N-statement $transaction inside attachImagesToProduct (the existing
  // reorder loop runs one update per id). 20 mirrors the iter-48 catalog cap.
  @ApiProperty({
    example: ["image-uuid-1", "image-uuid-2"],
    required: false,
    description:
      "Array of image IDs to attach to this product. First image will be the primary image.",
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID("all", { each: true })
  @IsOptional()
  imageIds?: string[];

  @ApiProperty({ example: 0, default: 0, required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;

  // KDV (VAT) rate for this product. TR allows 0 / 1 / 10 / 20. Defaults to 10
  // server-side. Previously fixed at 10 for every item with no way to set it —
  // mixed-rate menus (alcohol 20%, staples 1%) computed wrong KDV on every
  // receipt + z-report.
  @ApiProperty({
    example: 10,
    default: 10,
    required: false,
    enum: [0, 1, 10, 20],
  })
  @IsInt()
  @IsIn([0, 1, 10, 20])
  @IsOptional()
  taxRate?: number;

  // ── Combo + campaign + classification (menu combo feature) ──────────────
  @ApiPropertyOptional({ enum: ["STANDARD", "COMBO"], default: "STANDARD" })
  @IsIn(["STANDARD", "COMBO"])
  @IsOptional()
  productType?: "STANDARD" | "COMBO";

  @ApiPropertyOptional({
    description: "Combo slots. Only meaningful when productType=COMBO.",
    type: [ComboGroupDto],
  })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ComboGroupDto)
  @IsOptional()
  comboGroups?: ComboGroupDto[];

  @ApiPropertyOptional({
    example: 79.9,
    description: "KDV-inclusive campaign price. null clears the campaign.",
    nullable: true,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  campaignPrice?: number | null;

  @ApiPropertyOptional({ example: "%20 İndirim", nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  campaignLabel?: string | null;

  @ApiPropertyOptional({ example: "2026-07-10T00:00:00.000Z", nullable: true })
  @IsOptional()
  @IsDateString()
  campaignStartAt?: string | null;

  @ApiPropertyOptional({ example: "2026-07-31T23:59:59.000Z", nullable: true })
  @IsOptional()
  @IsDateString()
  campaignEndAt?: string | null;

  @ApiPropertyOptional({
    description: "Collection ids this product belongs to (replaces existing).",
    example: ["collection-uuid"],
  })
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID("all", { each: true })
  @IsOptional()
  collectionIds?: string[];
}
