import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class StockTransferItemDto {
  @ApiProperty()
  @IsUUID()
  sourceStockItemId: string;

  @ApiProperty()
  @IsUUID()
  destStockItemId: string;

  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity: number;

  @ApiPropertyOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @IsOptional()
  unitCost?: number;
}

export class CreateStockTransferDto {
  @ApiProperty({ description: "Destination branch" })
  @IsUUID()
  toBranchId: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ type: [StockTransferItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockTransferItemDto)
  items: StockTransferItemDto[];
}
