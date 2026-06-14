import { IsInt, IsOptional, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";

// Wave-C: shared, ADDITIVE opt-in pagination for the menu/modifiers list
// read-paths (products, categories, modifier groups, modifiers).
//
// Mirrors the stock-management list DTOs (limit/offset, @IsOptional +
// @Type(()=>Number) + @IsInt + @Min/@Max with a HARD_MAX cap) but with one
// deliberate difference: there is NO default value. When a caller omits
// limit/offset the field stays `undefined`, the service forwards
// `take: undefined / skip: undefined`, and Prisma returns the full list —
// so the default behaviour is byte-identical to the pre-pagination code.
// The response stays a bare array; no {data,total} envelope is introduced.
//
// HARD_MAX caps the page a single request can pull, mirroring the
// stock-management ceiling, so a hostile `?limit=999999999` is rejected by
// validation rather than streaming an unbounded result set.
export const LIST_QUERY_HARD_MAX = 5000;

export class ListQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: LIST_QUERY_HARD_MAX,
    description:
      "Optional page size. Omit to return the full list (default, unbounded).",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIST_QUERY_HARD_MAX)
  limit?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: "Optional number of rows to skip. Omit for no offset.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/**
 * Translate optional {limit, offset} into Prisma {take, skip}, keeping the
 * "no params => full list" default byte-identical.
 *
 * The global ValidationPipe already rejects junk query strings with a 400
 * before they reach a service, but services are also called directly (unit
 * tests, internal callers) where no DTO validation runs. This helper is the
 * service-layer backstop: a non-finite / non-positive `limit` or a
 * non-finite / negative `offset` collapses to `undefined` rather than being
 * forwarded as `take: NaN` (which Prisma would reject at runtime). A value
 * over the hard cap is clamped down to LIST_QUERY_HARD_MAX.
 *
 *   - both omitted        -> { take: undefined, skip: undefined } (full list)
 *   - valid limit/offset  -> { take: limit,     skip: offset }
 *   - junk/out-of-range   -> coerced to undefined (graceful fallback)
 */
export function sanitizePage(pagination?: {
  limit?: number;
  offset?: number;
}): { take: number | undefined; skip: number | undefined } {
  const rawLimit = pagination?.limit;
  const rawOffset = pagination?.offset;

  const take =
    typeof rawLimit === "number" &&
    Number.isInteger(rawLimit) &&
    rawLimit >= 1
      ? Math.min(rawLimit, LIST_QUERY_HARD_MAX)
      : undefined;

  const skip =
    typeof rawOffset === "number" &&
    Number.isInteger(rawOffset) &&
    rawOffset >= 0
      ? rawOffset
      : undefined;

  return { take, skip };
}
