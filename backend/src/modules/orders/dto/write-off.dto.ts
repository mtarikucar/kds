import { IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EmptyStringToUndefined } from '../../../common/dto/transforms';

/**
 * Body for POST /orders/:id/write-off — manager absorbs the remaining
 * balance on an order that won't be paid in full (no-show, comp).
 * The endpoint creates a single HOUSE-method Payment for the exact
 * remaining amount, which closes the order via finalizeFullyPaid
 * (without CRM stat bumps, since this isn't real revenue).
 */
export class WriteOffOrderDto {
  @ApiPropertyOptional({
    description:
      'Free-form reason for the write-off (no-show, comp, manager discretion). Persisted on Payment.notes for audit.',
  })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @Length(1, 240)
  reason?: string;
}
