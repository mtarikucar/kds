import { IsIn, IsOptional, IsInt, Min, Max, IsString, MaxLength } from 'class-validator';
import { EmptyStringToNumber } from '../../../common/dto/transforms';

/** Terminal outcomes a rep can record for a click-to-dial sales call. */
export const SALES_CALL_OUTCOMES = [
  'CONNECTED',
  'NO_ANSWER',
  'BUSY',
  'FAILED',
  'CANCELLED',
] as const;
export type SalesCallOutcome = (typeof SALES_CALL_OUTCOMES)[number];

export class LogCallDto {
  @IsIn(SALES_CALL_OUTCOMES)
  status!: SalesCallOutcome;

  /** Manually-entered talk time in seconds (provider-filled later via webhook). */
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400)
  durationSec?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
