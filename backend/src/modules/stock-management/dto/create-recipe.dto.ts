import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { EmptyStringToNumber } from "../../../common/dto/transforms";

// Iter-93: keep per-line ingredient count modest. A recipe with hundreds
// of distinct stock items is implausible (most kitchens have 5-30
// ingredients per dish); the cap bounds the createMany payload and the
// per-order ingredient lookup loop in StockDeductionService.
const MAX_RECIPE_INGREDIENTS = 100;
// Recipe metadata caps. The values are stored as-is and shown in the
// admin UI; oversize strings would bloat the listings without any
// product upside.
const RECIPE_NAME_MAX = 200;
const RECIPE_NOTES_MAX = 2000;

export class RecipeIngredientDto {
  @ApiProperty({ description: "Stock item UUID" })
  @IsUUID()
  stockItemId!: string;

  @ApiProperty({ description: "Quantity needed per recipe yield", minimum: 0 })
  @IsNumber()
  @Min(0)
  quantity!: number;

  @ApiPropertyOptional({
    description:
      "Recipe unit label when it differs from the stock unit (e.g. G)",
  })
  @IsString()
  @IsOptional()
  @MaxLength(24)
  recipeUnit?: string;

  @ApiPropertyOptional({
    description:
      "Base units per 1 recipe unit (1 G in KG = 0.001). Null = quantity is in the base unit.",
    minimum: 0,
  })
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @IsOptional()
  conversionFactor?: number;
}

export class CreateRecipeDto {
  @ApiProperty({ description: "Product UUID this recipe is for" })
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({
    description: "Recipe name (defaults to product name)",
  })
  @IsString()
  @IsOptional()
  @MaxLength(RECIPE_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ description: "Recipe notes" })
  @IsString()
  @IsOptional()
  @MaxLength(RECIPE_NOTES_MAX)
  notes?: string;

  @ApiPropertyOptional({
    description: "Number of portions this recipe makes",
    minimum: 1,
  })
  @EmptyStringToNumber()
  @IsNumber()
  @Min(1)
  @IsOptional()
  yield?: number;

  @ApiProperty({
    type: [RecipeIngredientDto],
    description: "Recipe ingredients (stockItemId must be unique)",
    minItems: 1,
    maxItems: MAX_RECIPE_INGREDIENTS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECIPE_INGREDIENTS)
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients!: RecipeIngredientDto[];
}
