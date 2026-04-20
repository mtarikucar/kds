import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

// Bounds match the world-grid assumptions used by the 3D layout. Negative
// coordinates are valid (origin is the grid centre). Rotation is in degrees.
export class UpdateTablePositionDto {
  @ApiProperty({ example: 0 })
  @IsNumber()
  @Min(-10_000)
  @Max(10_000)
  x: number;

  @ApiProperty({ example: 0 })
  @IsNumber()
  @Min(-10_000)
  @Max(10_000)
  y: number;

  @ApiProperty({ example: 0 })
  @IsNumber()
  @Min(-10_000)
  @Max(10_000)
  z: number;

  @ApiProperty({ example: 0 })
  @IsNumber()
  @Min(-360)
  @Max(360)
  rotation: number;
}
