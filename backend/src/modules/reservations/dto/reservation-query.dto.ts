import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsOptional,
  IsString,
  IsDateString,
  IsEnum,
  IsInt,
  Min,
  Max,
} from "class-validator";
import { Type } from "class-transformer";
import { ReservationStatus } from "../constants/reservation-status.enum";
import { EmptyStringToUndefined } from "../../../common/dto/transforms";

export class ReservationQueryDto {
  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsDateString()
  date?: string;

  // Inclusive date-range filter (YYYY-MM-DD). Applied by findAll only when
  // `date` is absent — `date` still wins for back-compat single-day callers.
  @ApiPropertyOptional({ description: "Range start (YYYY-MM-DD, inclusive)" })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: "Range end (YYYY-MM-DD, inclusive)" })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ enum: ReservationStatus })
  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tableId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
