import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RecipeIngredientDto } from './create-recipe.dto';

export class UpdateRecipeDto {
  @ApiPropertyOptional({ description: 'Recipe name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Recipe notes' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'Number of portions this recipe makes', minimum: 1 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  yield?: number;

  @ApiPropertyOptional({ type: [RecipeIngredientDto], description: 'Replace all ingredients' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  @IsOptional()
  ingredients?: RecipeIngredientDto[];
}
