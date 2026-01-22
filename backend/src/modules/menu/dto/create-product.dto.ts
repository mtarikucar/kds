import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsInt,
  Min,
  IsArray,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'Grilled Chicken' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Tender grilled chicken with herbs', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 12.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @ApiProperty({ example: 'https://example.com/image.jpg', required: false })
  @IsString()
  @IsOptional()
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
  @IsOptional()
  currentStock?: number;

  @ApiProperty({ example: 'category-uuid' })
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({
    example: ['image-uuid-1', 'image-uuid-2'],
    required: false,
    description: 'Array of image IDs to attach to this product. First image will be the primary image.'
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  imageIds?: string[];

  @ApiProperty({ example: 0, default: 0, required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;
}
