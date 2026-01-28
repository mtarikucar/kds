import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, IsObject, Min, Max } from 'class-validator';

export class CreateLayoutDto {
  @ApiPropertyOptional({
    description: 'Layout name',
    example: 'Main Floor',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description: 'World width in voxels',
    example: 32,
  })
  @IsInt()
  @Min(8)
  @Max(64)
  @IsOptional()
  width?: number;

  @ApiPropertyOptional({
    description: 'World height in voxels',
    example: 8,
  })
  @IsInt()
  @Min(4)
  @Max(16)
  @IsOptional()
  height?: number;

  @ApiPropertyOptional({
    description: 'World depth in voxels',
    example: 32,
  })
  @IsInt()
  @Min(8)
  @Max(64)
  @IsOptional()
  depth?: number;

  @ApiPropertyOptional({
    description: 'Voxel world data (objects, furniture positions)',
  })
  @IsObject()
  @IsOptional()
  worldData?: Record<string, unknown>;
}
