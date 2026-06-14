import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { MaxJsonBytes } from "../../../common/dto/max-json-bytes.validator";
import { CATEGORY_VALUES } from "../category-vocabulary";

// Cap on every free-form JSON column: generous for legit metadata, but stops
// a multi-MB blob being persisted and then serialized on every public
// storefront load (toPublicView). Mirrors the description/images caps.
const JSON_FIELD_MAX_BYTES = 16_384;

// Allowed category values for the @IsIn gate — derived from the single
// category vocabulary (value + TR label + order) in ../category-vocabulary,
// which the storefront also fetches via GET /v1/catalog/categories. Adding a
// category is now a one-place change.
const CATEGORIES = CATEGORY_VALUES;
const STATUSES = ["draft", "published", "archived"] as const;

// Regulatory sale tiers (TR law). Kept as plain string literals to mirror the
// CATEGORIES/STATUSES style; the canonical type is Prisma's HardwareSaleMode.
export const SALE_MODES = [
  "DIRECT_SALE", // Tier 3 — normal sale, seller-responsibility docs apply
  "QUOTE_ONLY", // Tier 1 — yazarkasa / YN ÖKC; teklif/kurulum via dealer + GİB
  "PARTNER_REDIRECT", // Tier 2 — bank POS; redirect to a licensed bank/PSP
  "RECOMMENDED_ONLY", // Tier 4 — uncertified scale etc.; recommended only
] as const;
export type SaleMode = (typeof SALE_MODES)[number];

// Default regulatory tier per category. Applied by CatalogService when an
// admin omits saleMode, and by backend/prisma/seeds/seed-marketplace.ts.
// Per-product override is always allowed — saleMode is a real column, so this
// map is only the default, not a hard constraint. Single source of truth: the
// storefront reads saleMode off the product payload (no duplicate FE copy).
export const CATEGORY_DEFAULT_SALE_MODE: Record<string, SaleMode> = {
  yazarkasa: "QUOTE_ONLY", // Tier 1 — fiscal
  pos_terminal: "PARTNER_REDIRECT", // Tier 2 — bank/payment terminal
  printer: "DIRECT_SALE",
  kds_screen: "DIRECT_SALE",
  tablet: "DIRECT_SALE",
  scanner: "DIRECT_SALE",
  caller_id: "DIRECT_SALE",
  cash_drawer: "DIRECT_SALE",
  bridge: "DIRECT_SALE",
  scale: "RECOMMENDED_ONLY", // Tier 4 — safe default; admin overrides to DIRECT_SALE only with docs
  cable: "DIRECT_SALE",
  accessory: "DIRECT_SALE",
  service: "DIRECT_SALE", // fiscal-install services overridden per-row to QUOTE_ONLY
};

export class CreateHardwareProductDto {
  @ApiProperty({
    example: "pos-ingenico-lane3000",
    description: "Unique SKU (lowercase + hyphens)",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]{2,63}$/, {
    message: "sku must be lowercase, alphanumeric + hyphen, 3-64 chars",
  })
  sku: string;

  @ApiProperty({ example: "yazarkasa", enum: CATEGORIES })
  @IsString()
  @IsIn(CATEGORIES as unknown as string[])
  category: string;

  @ApiProperty({ example: "Hugin Tiger T300 4G Yazarkasa POS" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({ required: false, example: "Ingenico" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @ApiProperty({ required: false, example: "Lane 3000" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  // 5000 chars covers a paragraph-style product description (real
  // entries are 100-500 chars). Without this, an admin could persist
  // a multi-MB blob into the description column — every public-
  // storefront load then serializes it on every request.
  @ApiProperty({
    required: false,
    description: "Plain-text product description",
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({
    required: false,
    type: Object,
    description: "Free-form spec sheet (display, ports, etc.)",
  })
  @IsOptional()
  @IsObject()
  @MaxJsonBytes(JSON_FIELD_MAX_BYTES)
  specs?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    type: Object,
    description: "Compatibility matrix (e.g. supported POS apps)",
  })
  @IsOptional()
  @IsObject()
  @MaxJsonBytes(JSON_FIELD_MAX_BYTES)
  compat?: Record<string, unknown>;

  // v2.8.87 — structured rich detail used by the product/service detail
  // page. Shape:
  //   {
  //     includes?: string[],        // "Neler dahil" bullet list
  //     requirements?: string[],    // pre-arrival requirements
  //     faq?: { q: string; a: string }[],
  //     steps?: { title: string; body: string }[],
  //     videoUrl?: string,
  //     gallery?: string[]          // extra images beyond `images[]`
  //   }
  // Per-locale variants supported via { tr: {...}, en: {...} } — the
  // client selects the current locale at render-time, falls back to `tr`.
  // Empty/null is fine: the detail page renders only the spec tab.
  @ApiProperty({
    required: false,
    type: Object,
    description:
      "Rich detail for the product/service detail page (includes, requirements, faq, steps, videoUrl)",
  })
  @IsOptional()
  @IsObject()
  @MaxJsonBytes(JSON_FIELD_MAX_BYTES)
  details?: Record<string, unknown>;

  // v2.8.87 — service-only metadata. Shape:
  //   {
  //     durationHours?: number,
  //     geoCoverage?: string[],            // ["İstanbul", "Ankara", ...]
  //     requiresBranch?: boolean,          // forces branch picker at order time
  //     serviceType: 'onsite'|'remote'|'consultation'
  //   }
  // CheckoutService reads serviceType to decide whether to mint an
  // InstallationRequest at provision-time (`onsite` only).
  @ApiProperty({
    required: false,
    type: Object,
    description:
      "Service-only metadata (durationHours, geoCoverage, requiresBranch, serviceType)",
  })
  @IsOptional()
  @IsObject()
  @MaxJsonBytes(JSON_FIELD_MAX_BYTES)
  serviceMeta?: Record<string, unknown>;

  @ApiProperty({
    example: 1299900,
    description: "Sale price in minor units (kuruş)",
  })
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  priceCents: number;

  @ApiProperty({
    required: false,
    example: 19900,
    description: "Monthly rental price in minor units",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  rentalMonthlyCents?: number;

  @ApiProperty({ required: false, example: "TRY", default: "TRY" })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: "currency must be a 3-letter ISO code" })
  currency?: string;

  @ApiProperty({
    required: false,
    example: 12,
    default: 12,
    description: "Warranty in months",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  warrantyMonths?: number;

  @ApiProperty({
    required: false,
    type: [String],
    description:
      "Product image URLs — absolute (https://...) or root-relative (/products/<sku>.webp)",
    maxItems: 20,
  })
  @IsOptional()
  @IsArray()
  // 20 covers the real product-gallery case (hero + detail shots + a
  // few angle variants); without the cap an admin could persist a
  // 10k-entry array on every product row.
  @ArrayMaxSize(20)
  // Accept both absolute URLs (vendor CDN) and root-relative paths
  // (self-hosted under landing/public/products/). The previous IsUrl()
  // rejected the seed's own /products/<sku>.webp pattern; any admin
  // upsert that copied the existing row's images out would 400.
  @Matches(/^(https?:\/\/[^\s]+|\/[^\s]*)$/, {
    each: true,
    message:
      "each image must be an absolute URL (https://...) or root-relative path (/...)",
  })
  // Cap each URL at 2048 (RFC 9110-ish browser-friendly URL ceiling)
  // so a hostile entry can't store a megabyte data: URI or similar.
  @MaxLength(2048, { each: true })
  images?: string[];

  @ApiProperty({
    required: false,
    type: Object,
    description: "Carrier / weight / dim profile for shipping calc",
  })
  @IsOptional()
  @IsObject()
  @MaxJsonBytes(JSON_FIELD_MAX_BYTES)
  shippingProfile?: Record<string, unknown>;

  @ApiProperty({ required: false, enum: STATUSES, default: "draft" })
  @IsOptional()
  @IsString()
  @IsIn(STATUSES as unknown as string[])
  status?: string;

  // Regulatory tier. When omitted, CatalogService defaults it from
  // CATEGORY_DEFAULT_SALE_MODE[category]. The checkout guard
  // (QuoteService.quote) blocks any non-DIRECT_SALE SKU from a cart.
  @ApiProperty({
    required: false,
    enum: SALE_MODES,
    description: "Regulatory sale tier — defaults from category when omitted",
  })
  @IsOptional()
  @IsString()
  @IsIn(SALE_MODES as unknown as string[])
  saleMode?: string;

  // Tier 2 (PARTNER_REDIRECT) target. Shape:
  //   { partnerName: string, partnerUrl: string, disclaimer?: string }
  @ApiProperty({
    required: false,
    type: Object,
    description:
      "Bank/PSP redirect target for PARTNER_REDIRECT products (partnerName, partnerUrl, disclaimer)",
  })
  @IsOptional()
  @IsObject()
  @MaxJsonBytes(JSON_FIELD_MAX_BYTES)
  partnerRedirect?: Record<string, unknown>;

  // Tier 3 (DIRECT_SALE) seller-responsibility compliance docs. Shape:
  //   { invoiceIssued?, warrantyCertUrl?, distributorName?, ceConformityUrl?,
  //     turkishManualUrl?, serviceInfo?, returnTermsUrl? }
  @ApiProperty({
    required: false,
    type: Object,
    description:
      "Seller-responsibility compliance docs (warranty, distributor, CE, manual, service, return terms)",
  })
  @IsOptional()
  @IsObject()
  @MaxJsonBytes(JSON_FIELD_MAX_BYTES)
  complianceDocs?: Record<string, unknown>;
}
