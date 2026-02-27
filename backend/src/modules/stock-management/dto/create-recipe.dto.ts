import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecipeIngredientDto {
  @ApiProperty({ description: 'Stock item ID' })
  @IsString()
  stockItemId: string;

  @ApiProperty({ description: 'Quantity needed per recipe yield', minimum: 0 })
  @IsNumber()
  @Min(0)
  quantity: number;
}

export class CreateRecipeDto {
  @ApiProperty({ description: 'Product ID this recipe is for' })
  @IsString()
  productId: string;

  @ApiPropertyOptional({ description: 'Recipe name (defaults to product name)' })
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

  @ApiProperty({ type: [RecipeIngredientDto], description: 'Recipe ingredients' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients: RecipeIngredientDto[];
}
