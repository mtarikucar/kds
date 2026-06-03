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

// Categories the seed + frontend storefront actually use, plus a few
// generic buckets. Kept in sync with frontend/src/features/hardware-store/
// StorePage.tsx and backend/prisma/seeds/seed-marketplace.ts. Adding a
// category requires touching all three.
const CATEGORIES = [
  "yazarkasa", // YN ÖKC (GİB-certified)
  "pos_terminal", // generic POS terminal (non-fiscal)
  "printer", // thermal receipt + kitchen printers
  "kds_screen", // kitchen display screen
  "tablet", // garson / customer-facing tablet
  "scanner", // barcode scanner
  "caller_id", // arayan numara modülü
  "cash_drawer", // para çekmecesi
  "bridge", // network bridge (HummyBox)
  "scale", // tartı
  "cable",
  "accessory",
  "service", // installation / setup services
] as const;
const STATUSES = ["draft", "published", "archived"] as const;

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
  specs?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    type: Object,
    description: "Compatibility matrix (e.g. supported POS apps)",
  })
  @IsOptional()
  @IsObject()
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
  shippingProfile?: Record<string, unknown>;

  @ApiProperty({ required: false, enum: STATUSES, default: "draft" })
  @IsOptional()
  @IsString()
  @IsIn(STATUSES as unknown as string[])
  status?: string;
}
