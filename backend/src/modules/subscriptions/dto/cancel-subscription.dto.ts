import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Body for POST /subscriptions/:id/cancel.
 *
 * Without a class-validator DTO the controller was reading the body as a
 * raw `{ immediate?: boolean; reason?: string }` literal — global
 * ValidationPipe only fires when the @Body parameter is typed as a class.
 * That left `reason` uncapped, so a client could persist up to the
 * body-parser limit (100KB) into the `cancellationReason` DB column.
 * Cap at 500 chars, which is plenty for human-readable churn reasons.
 */
export class CancelSubscriptionDto {
  @IsBoolean()
  @IsOptional()
  immediate?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
