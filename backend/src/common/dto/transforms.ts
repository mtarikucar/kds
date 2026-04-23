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

/**
 * Numeric companion to `EmptyStringToUndefined`. HTML forms submit number
 * inputs as strings; unchecked boxes and empty text fields arrive as `""`.
 * `@IsOptional()` + `@IsNumber()` + `@Min()` will then coerce `""` through
 * `Number("")` which is `0` (passes `@Min(0)`!) or `Number(" ")` which is
 * `NaN` (fails `@Min` with a confusing message). Either way the wrong
 * value lands in the domain.
 *
 * Collapse empty/whitespace to `undefined` and parse anything else; if
 * parsing yields `NaN`, return `undefined` so `@IsOptional()` can skip the
 * field rather than `@IsNumber()` asserting on garbage.
 *
 * Usage:
 *   `@EmptyStringToNumber()`
 *   `@IsNumber()`
 *   `@IsOptional()`
 *   `@Min(0)`
 *   field?: number;
 */
export const EmptyStringToNumber = () =>
  Transform(({ value }: TransformFnParams) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    if (typeof value === 'number') return Number.isNaN(value) ? undefined : value;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  });

/**
 * Cast stringified booleans ("true"/"false"/"1"/"0") into real booleans
 * before `@IsBoolean()` runs. Query strings and `FormData` never carry
 * real booleans, so toggles sent as `"true"` / `"false"` otherwise fail
 * validation even though the intent is clear.
 *
 * Unknown or empty values pass through as `undefined` so `@IsOptional()`
 * can still short-circuit.
 *
 * Usage:
 *   `@StringToBoolean()`
 *   `@IsBoolean()`
 *   `@IsOptional()`
 *   field?: boolean;
 */
export const StringToBoolean = () =>
  Transform(({ value }: TransformFnParams) => {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === '') return undefined;
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
    }
    if (value === 1) return true;
    if (value === 0) return false;
    return value;
  });
