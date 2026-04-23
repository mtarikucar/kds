import { Transform, TransformFnParams } from 'class-transformer';

/**
 * class-validator's `@IsOptional()` only skips validation for `null` and
 * `undefined`. HTML/JSON forms routinely submit empty strings for unfilled
 * optional fields, which sail past `@IsString()` and then trip `@MinLength`
 * / `@Length` / `@Matches` with confusing messages like
 * "transactionId must be longer than or equal to 1 characters".
 *
 * Apply this transform decorator BEFORE the type/length validators so an
 * empty (or whitespace-only) string collapses to `undefined` and
 * `@IsOptional()` can actually opt the field out.
 *
 * Usage:
 *   `@EmptyStringToUndefined()`
 *   `@IsString()`
 *   `@IsOptional()`
 *   `@Length(1, 128)`
 *   field?: string;
 */
export const EmptyStringToUndefined = () =>
  Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  );
