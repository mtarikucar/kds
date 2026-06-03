import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNumber,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateModifierDto {
  // String caps mirror CreateModifierGroupDto + the iter-48 catalog pattern.
  @ApiProperty({ example: "extra_cheese" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: "Ekstra Peynir" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  displayName: string;

  @ApiProperty({ example: "+50gr kaşar peyniri", required: false })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  // Schema column is Decimal(10, 2) — anything above 99,999,999.99 surfaces
  // as a 500 from Postgres. 10,000 covers every realistic "add a side"
  // upcharge with three orders of magnitude of headroom and keeps the
  // computed Order.totalAmount from running into the same overflow when a
  // line multiplies modifier price by quantity. Negative values are
  // intentionally rejected here even though the schema allows them — the
  // service-side flow has no "discount modifier" path today.
  @ApiProperty({ example: 25.0, default: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000)
  @IsOptional()
  priceAdjustment?: number;

  @ApiProperty({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  isAvailable?: boolean;

  @ApiProperty({ example: 0, default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;

  @ApiProperty({ example: "uuid-of-modifier-group" })
  @IsUUID()
  groupId: string;
}
