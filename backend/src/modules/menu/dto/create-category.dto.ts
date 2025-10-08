import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Main Dishes' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Delicious main course options', required: false })
  @IsString()
  @IsOptional()
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
