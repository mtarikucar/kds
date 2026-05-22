import { IsOptional, IsString, IsInt, IsDateString, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { EmptyStringToUndefined } from '../../../common/dto/transforms';

export class LeadFilterDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  businessType?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  // Coarse-grained assignment filter used by the "Atanmamış / Atanmış /
  // Bana atanmış" pills in the leads list. Lives alongside the
  // fine-grained `assignedToId` filter: a manager can stack them
  // (e.g., "mine" + a specific date range). Reps see only their own
  // leads regardless of this filter — enforced in the service.
  @IsOptional()
  @IsIn(['unassigned', 'assigned', 'mine'])
  assignmentStatus?: 'unassigned' | 'assigned' | 'mine';

  @IsOptional()
  @IsString()
  priority?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
