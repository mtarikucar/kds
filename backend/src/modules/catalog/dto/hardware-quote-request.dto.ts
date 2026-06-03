import { ApiProperty } from "@nestjs/swagger";
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

/**
 * Storefront "Teklif Al" payload for a QUOTE_ONLY device (yazarkasa / YN ÖKC).
 * These devices are not directly purchasable; the request becomes a marketing
 * Lead (source=HARDWARE_QUOTE) so a rep can run the dealer/installation +
 * GİB process. The buyer is an authenticated tenant — businessName is taken
 * from the tenant, so only the contact details + SKU are needed here.
 */
export class HardwareQuoteRequestDto {
  @ApiProperty({ example: "yazarkasa-hugin-tiger-t300" })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]{2,63}$/, {
    message: "sku must be lowercase, alphanumeric + hyphen, 3-64 chars",
  })
  sku: string;

  @ApiProperty({ required: false, example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  qty?: number;

  @ApiProperty({ example: "Ahmet Yılmaz" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  contactPerson: string;

  @ApiProperty({ required: false, example: "+90 5xx xxx xx xx" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @ApiProperty({ required: false, description: "Free-text notes for the rep" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
