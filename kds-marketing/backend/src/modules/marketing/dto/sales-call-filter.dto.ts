import { IsOptional, IsUUID, IsIn, IsInt, Min, Max } from 'class-validator';
import { EmptyStringToNumber } from '../../../common/dto/transforms';

export class SalesCallFilterDto {
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsIn(['INITIATED', 'CONNECTED', 'NO_ANSWER', 'BUSY', 'FAILED', 'CANCELLED'])
  status?: string;

  /** Manager-only: scope to a specific rep. Reps always see only their own calls. */
  @IsOptional()
  @IsUUID()
  marketingUserId?: string;
}
