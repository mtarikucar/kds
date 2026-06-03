import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class ReceiveStockDto {
  @ApiProperty({ example: 10, description: "Units received (must be ≥ 1)" })
  @IsInt()
  @Min(1)
  @Max(10_000)
  qty: number;

  @ApiProperty({
    required: false,
    type: [String],
    description: "Optional serials — at most qty entries; extras are ignored",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10_000)
  @IsString({ each: true })
  // Real device serials are alphanumeric, 6-40 chars. Cap at 128
  // per element for headroom while keeping the worst-case payload
  // bounded — 10k entries × 128 chars = ~1.2MB, manageable. Match
  // against the alphanumeric+punct set so a hostile entry can't
  // smuggle control characters into the serial column (which the
  // operator UI then prints on a stock label).
  @MaxLength(128, { each: true })
  @Matches(/^[A-Za-z0-9._:-]+$/, {
    each: true,
    message: "each serial must be alphanumeric + . _ : - (1-128 chars)",
  })
  serials?: string[];
}
