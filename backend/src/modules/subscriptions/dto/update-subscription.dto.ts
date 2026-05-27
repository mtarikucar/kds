import { IsOptional, IsBoolean } from "class-validator";

/**
 * PATCH /subscriptions/:id — the service only honours
 * `cancelAtPeriodEnd`. A `billingCycle` field previously lived here too
 * but `updateSubscription` silently ignored it, so clients got a
 * 200-success even though nothing changed. Removed to stop misleading
 * the API surface; cycle changes go through POST /change-plan instead.
 */
export class UpdateSubscriptionDto {
  @IsBoolean()
  @IsOptional()
  cancelAtPeriodEnd?: boolean;
}
