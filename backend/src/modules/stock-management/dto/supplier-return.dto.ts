import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class SupplierReturnItemDto {
  @ApiProperty()
  @IsUUID()
  stockItemId: string;

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

export class SupplierReturnDto {
  @ApiProperty()
  @IsUUID()
  supplierId: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;

  @ApiProperty({ type: [SupplierReturnItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SupplierReturnItemDto)
  items: SupplierReturnItemDto[];
}
