import { IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateStockCountItemDto {
  @ApiProperty({ description: 'Actual counted quantity', minimum: 0 })
  @IsNumber()
  @Min(0)
  countedQty: number;
}
