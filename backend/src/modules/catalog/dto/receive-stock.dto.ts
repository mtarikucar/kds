import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ReceiveStockDto {
  @ApiProperty({ example: 10, description: 'Units received (must be ≥ 1)' })
  @IsInt()
  @Min(1)
  @Max(10_000)
  qty: number;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Optional serials — at most qty entries; extras are ignored',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10_000)
  @IsString({ each: true })
  serials?: string[];
}
