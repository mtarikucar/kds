import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
} from 'class-validator';

// http(s):// for vendor images, or `/` for self-hosted (landing/public assets).
// Blocks `javascript:` / `data:` / `vbscript:` — the legacy `image` column lands
// straight into the public QR menu's <img src>; browsers ignore `javascript:`
// on <img> tags but a `data:` URL big enough to qualify as a page is
// indistinguishable from a stored-XSS payload to downstream consumers.
const PRODUCT_IMAGE_URL_REGEX = /^(https?:\/\/|\/)/;

export class CreateProductDto {
  @ApiProperty({ example: 'Grilled Chicken' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  // Description is Postgres TEXT — no implicit ceiling. 5,000 is roomy for
  // long-form menu copy without letting a bug-driven write seed a multi-MB row.
  @ApiProperty({ example: 'Tender grilled chicken with herbs', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  // Schema is Decimal(10, 2) — anything above 99,999,999.99 surfaces as a 500
  // from Postgres. 10,000,000 mirrors the payment-amount cap (iter-42); any
  // realistic menu item is several orders below.
  @ApiProperty({ example: 12.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  price: number;

  @ApiProperty({ example: 'https://example.com/image.jpg', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(2048)
  @Matches(PRODUCT_IMAGE_URL_REGEX, {
    message: 'image must be an absolute http(s) URL or a `/`-rooted path',
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

  @ApiProperty({ example: 0, default: 0, required: false })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  @IsOptional()
  currentStock?: number;

  @ApiProperty({ example: 'category-uuid' })
  @IsUUID()
  categoryId: string;

  // Hard cap on imageIds so a malicious / buggy client can't trigger an
  // N-statement $transaction inside attachImagesToProduct (the existing
  // reorder loop runs one update per id). 20 mirrors the iter-48 catalog cap.
  @ApiProperty({
    example: ['image-uuid-1', 'image-uuid-2'],
    required: false,
    description: 'Array of image IDs to attach to this product. First image will be the primary image.'
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  @IsOptional()
  imageIds?: string[];

  @ApiProperty({ example: 0, default: 0, required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;
}
