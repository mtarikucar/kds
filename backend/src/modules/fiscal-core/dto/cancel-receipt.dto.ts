import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for POST /v1/fiscal/receipts/:id/cancel.
 *
 * `reason` is persisted to `fiscal_receipts.lastError` (prefixed with
 * "cancelled: "). Without a class-validator DTO, NestJS's global
 * ValidationPipe doesn't run — the column had no upstream cap and an
 * operator (or compromised admin session) could push body-parser-sized
 * strings into a TR-law-mandated audit row. Cap at 500 chars; that's
 * already longer than any realistic ops note.
 */
export class CancelReceiptDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
