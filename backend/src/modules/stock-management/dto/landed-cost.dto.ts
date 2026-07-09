import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsNumber, IsOptional, Max, Min } from "class-validator";

/** Extra receipt costs to allocate across a received PO's lines. */
export class LandedCostDto {
  @ApiPropertyOptional({ description: "Freight / shipping cost" })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  @IsOptional()
  freight?: number;

  @ApiPropertyOptional({ description: "Customs / duty cost" })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  @IsOptional()
  customs?: number;

  @ApiPropertyOptional({ description: "Other allocable cost" })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  @IsOptional()
  other?: number;
}
