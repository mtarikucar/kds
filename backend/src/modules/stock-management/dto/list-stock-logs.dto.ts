import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IngredientMovementType,
  WasteReason,
} from '../../../common/constants/stock-management.enum';

// Iter-92: shared shape for the stock-management list endpoints
// (`/stock-management/waste-logs` and `/stock-management/movements`).
// Before this DTO existed, the controllers accepted bare @Query strings
// and pushed them straight into Prisma — a non-ISO startDate produced
// `new Date(NaN)` and silently matched nothing (iter-87 trap), an
// arbitrary `type`/`reason` string went into the Prisma `where`
// unchecked, and waste-logs had no pagination at all.

const HARD_MAX_TAKE = 5000;

export class ListWasteLogsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by stock item UUID' })
  @IsOptional()
  @IsUUID()
  stockItemId?: string;

  @ApiPropertyOptional({ enum: WasteReason })
  @IsOptional()
  @IsEnum(WasteReason)
  reason?: WasteReason;

  @ApiPropertyOptional({ description: 'ISO-8601 start date' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'ISO-8601 end date' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  // Pagination — pre-iter-92 waste-logs had none. A year of waste logs on
  // a chain tenant streamed thousands of rows per request.
  @ApiPropertyOptional({ minimum: 1, maximum: HARD_MAX_TAKE, default: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HARD_MAX_TAKE)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class WasteLogsSummaryQueryDto {
  @ApiPropertyOptional({ description: 'ISO-8601 start date' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'ISO-8601 end date' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class ListIngredientMovementsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by stock item UUID' })
  @IsOptional()
  @IsUUID()
  stockItemId?: string;

  @ApiPropertyOptional({ enum: IngredientMovementType })
  @IsOptional()
  @IsEnum(IngredientMovementType)
  type?: IngredientMovementType;

  @ApiPropertyOptional({ description: 'ISO-8601 start date' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'ISO-8601 end date' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: HARD_MAX_TAKE, default: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HARD_MAX_TAKE)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
