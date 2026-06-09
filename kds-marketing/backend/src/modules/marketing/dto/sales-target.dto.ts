import {
  IsUUID,
  IsIn,
  IsNumber,
  Min,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

/** Metrics a target can be set on; each maps to a marketing-owned actual. */
export const TARGET_METRICS = [
  'WON_LEADS', // count of leads converted (status WON) in the period
  'COMMISSION_AMOUNT', // sum of commissions accrued in the period
  'CONNECTED_CALLS', // count of sales calls logged CONNECTED in the period
] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];

const PERIOD = /^\d{4}-\d{2}$/;

export class SetTargetDto {
  @IsUUID()
  marketingUserId!: string;

  @Matches(PERIOD, { message: 'period must be YYYY-MM' })
  period!: string;

  @IsIn(TARGET_METRICS)
  metric!: TargetMetric;

  @IsNumber()
  @Min(0)
  targetValue!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class TargetFilterDto {
  @IsOptional()
  @Matches(PERIOD, { message: 'period must be YYYY-MM' })
  period?: string;

  @IsOptional()
  @IsUUID()
  marketingUserId?: string;
}
