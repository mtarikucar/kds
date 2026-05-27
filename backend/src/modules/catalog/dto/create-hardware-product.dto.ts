import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

// Categories the seed + frontend storefront actually use, plus a few
// generic buckets. Kept in sync with frontend/src/features/hardware-store/
// StorePage.tsx and backend/prisma/seeds/seed-marketplace.ts. Adding a
// category requires touching all three.
const CATEGORIES = [
  'yazarkasa',     // YN ÖKC (GİB-certified)
  'pos_terminal',  // generic POS terminal (non-fiscal)
  'printer',       // thermal receipt + kitchen printers
  'kds_screen',    // kitchen display screen
  'tablet',        // garson / customer-facing tablet
  'scanner',       // barcode scanner
  'caller_id',     // arayan numara modülü
  'cash_drawer',   // para çekmecesi
  'bridge',        // network bridge (HummyBox)
  'scale',         // tartı
  'cable',
  'accessory',
  'service',       // installation / setup services
] as const;
const STATUSES = ['draft', 'published', 'archived'] as const;

export class CreateHardwareProductDto {
  @ApiProperty({ example: 'pos-ingenico-lane3000', description: 'Unique SKU (lowercase + hyphens)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]{2,63}$/, {
    message: 'sku must be lowercase, alphanumeric + hyphen, 3-64 chars',
  })
  sku: string;

  @ApiProperty({ example: 'yazarkasa', enum: CATEGORIES })
  @IsString()
  @IsIn(CATEGORIES as unknown as string[])
  category: string;

  @ApiProperty({ example: 'Hugin Tiger T300 4G Yazarkasa POS' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false, example: 'Ingenico' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiProperty({ required: false, example: 'Lane 3000' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiProperty({ required: false, description: 'Plain-text product description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false, type: Object, description: 'Free-form spec sheet (display, ports, etc.)' })
  @IsOptional()
  @IsObject()
  specs?: Record<string, unknown>;

  @ApiProperty({ required: false, type: Object, description: 'Compatibility matrix (e.g. supported POS apps)' })
  @IsOptional()
  @IsObject()
  compat?: Record<string, unknown>;

  @ApiProperty({ example: 1299900, description: 'Sale price in minor units (kuruş)' })
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  priceCents: number;

  @ApiProperty({ required: false, example: 19900, description: 'Monthly rental price in minor units' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  rentalMonthlyCents?: number;

  @ApiProperty({ required: false, example: 'TRY', default: 'TRY' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  currency?: string;

  @ApiProperty({ required: false, example: 12, default: 12, description: 'Warranty in months' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  warrantyMonths?: number;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Product image URLs — absolute (https://...) or root-relative (/products/<sku>.webp)',
  })
  @IsOptional()
  @IsArray()
  // Accept both absolute URLs (vendor CDN) and root-relative paths
  // (self-hosted under landing/public/products/). The previous IsUrl()
  // rejected the seed's own /products/<sku>.webp pattern; any admin
  // upsert that copied the existing row's images out would 400.
  @Matches(/^(https?:\/\/[^\s]+|\/[^\s]*)$/, {
    each: true,
    message: 'each image must be an absolute URL (https://...) or root-relative path (/...)',
  })
  images?: string[];

  @ApiProperty({
    required: false,
    type: Object,
    description: 'Carrier / weight / dim profile for shipping calc',
  })
  @IsOptional()
  @IsObject()
  shippingProfile?: Record<string, unknown>;

  @ApiProperty({ required: false, enum: STATUSES, default: 'draft' })
  @IsOptional()
  @IsString()
  @IsIn(STATUSES as unknown as string[])
  status?: string;
}
