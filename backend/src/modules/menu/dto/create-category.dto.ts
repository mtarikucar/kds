import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsInt, MaxLength, Min } from 'class-validator';

export class CreateCategoryDto {
  // Category.name + description are Postgres TEXT — no implicit ceiling.
  // 100/2000 mirrors the modifiers (iter-56) + catalog (iter-48) shape.
  @ApiProperty({ example: 'Main Dishes' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'Delicious main course options', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 1, default: 0, required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;

  @ApiProperty({ example: true, default: true, required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
