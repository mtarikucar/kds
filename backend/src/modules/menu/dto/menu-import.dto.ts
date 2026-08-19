import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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

  /**
   * What to do when this row already exists in the target category. The
   * server annotates the row on parse; the operator may change it in the
   * review grid. Absent means CREATE — that is what every pre-conflict
   * caller (BulkAddModal, the photo flow) sends, and it keeps their
   * behaviour byte-identical.
   */
  @ApiProperty({ required: false, enum: ["SKIP", "UPDATE_PRICE", "CREATE"] })
  @IsOptional()
  @IsIn(["SKIP", "UPDATE_PRICE", "CREATE"])
  onConflict?: "SKIP" | "UPDATE_PRICE" | "CREATE";

  /**
   * The product this row collided with. Re-checked server-side before
   * UPDATE_PRICE writes it — both tenant ownership AND that the row's
   * (category, name), folded the same way annotateConflicts matched it,
   * still resolves to this same product id. A rename in the review grid,
   * or an id that belongs to a different product, fails that row instead
   * of silently repricing whatever this id currently points to.
   */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  existingProductId?: string;

  /**
   * Set by annotateConflicts when this row's (category, name) fold key
   * matches more than one existing product, or is claimed by an earlier
   * row in the same draft — the server deliberately did not pick a
   * winner. Declared (unlike existingPrice) because commitDraft must be
   * able to read it back: without it, whitelist:true strips an
   * undeclared property on the way into /commit and the server loses the
   * one signal that stops it from creating an unwanted third duplicate.
   */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  ambiguous?: boolean;
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
