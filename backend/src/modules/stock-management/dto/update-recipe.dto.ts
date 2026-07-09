import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { RecipeIngredientDto, RecipeComponentDto } from "./create-recipe.dto";

// Iter-93: keep same caps as Create. Update can replace the ingredients
// list outright; the size guard still applies.
const MAX_RECIPE_INGREDIENTS = 100;
const RECIPE_NAME_MAX = 200;
const RECIPE_NOTES_MAX = 2000;

export class UpdateRecipeDto {
  @ApiPropertyOptional({ description: "Recipe name" })
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
  @IsNumber()
  @Min(1)
  @IsOptional()
  yield?: number;

  @ApiPropertyOptional({
    type: [RecipeIngredientDto],
    description: "Replace all ingredients (stockItemId must be unique)",
    maxItems: MAX_RECIPE_INGREDIENTS,
  })
  @IsArray()
  @ArrayMaxSize(MAX_RECIPE_INGREDIENTS)
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  @IsOptional()
  ingredients?: RecipeIngredientDto[];

  @ApiPropertyOptional({
    type: [RecipeComponentDto],
    description: "Replace all sub-recipe components (nested BOM)",
    maxItems: MAX_RECIPE_INGREDIENTS,
  })
  @IsArray()
  @ArrayMaxSize(MAX_RECIPE_INGREDIENTS)
  @ValidateNested({ each: true })
  @Type(() => RecipeComponentDto)
  @IsOptional()
  components?: RecipeComponentDto[];
}
