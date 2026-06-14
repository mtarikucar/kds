/**
 * Coerce a ConfigService value to a non-negative number.
 *
 * `ConfigService.get<number>('KEY', default)` is a compile-time lie: when the
 * env var IS set, validate() (class-transformer) passes it through as the raw
 * STRING unless the key is declared+typed in EnvironmentVariables. A raw string
 * silently corrupts numeric arithmetic — e.g. `new Date(Date.now() + ttl)`
 * becomes string concatenation → Invalid Date → Prisma throws on the DateTime
 * column. This helper coerces explicitly and falls back to the literal default
 * on a missing / non-finite / negative value, so a malformed override can never
 * break a business write.
 */
export function numericEnv(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
