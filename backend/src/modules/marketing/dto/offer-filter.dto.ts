import { IsOptional, IsString, IsDateString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { EmptyStringToUndefined } from '../../../common/dto/transforms';

export class OfferFilterDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  leadId?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number;
}
