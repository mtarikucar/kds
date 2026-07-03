import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

/**
 * A single product parsed from a menu photo. Mirrors the fields
 * CreateProductDto accepts on commit (name/description/price/taxRate); images
 * are attached later from the Image Library, not by OCR.
 */
export class MenuImportProductDraftDto {
  @ApiProperty({ example: "Adana Kebap" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({ example: 180 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  price: number;

  // KDV rate (0/1/10/20). Left optional; commit defaults it to 10 like
  // ProductsService.create so the fiscal math stays correct.
  @ApiProperty({ required: false, enum: [0, 1, 10, 20] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1, 10, 20])
  taxRate?: number;
}

export class MenuImportCategoryDraftDto {
  @ApiProperty({ example: "Ana Yemekler" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiProperty({ type: [MenuImportProductDraftDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MenuImportProductDraftDto)
  products: MenuImportProductDraftDto[];
}

/**
 * The operator-reviewed draft submitted to the commit endpoint. Same shape the
 * parse endpoint returns, after the review grid edits it.
 */
export class CommitMenuImportDto {
  @ApiProperty({ type: [MenuImportCategoryDraftDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MenuImportCategoryDraftDto)
  categories: MenuImportCategoryDraftDto[];
}
