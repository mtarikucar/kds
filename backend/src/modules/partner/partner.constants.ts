/**
 * Scopes a PartnerApiKey (and the ScreenSessions it mints) may carry. A screen
 * token's effective scopes are always a subset of its parent key's scopes, and
 * each /display endpoint requires a specific one via @RequireScope.
 */
export const PARTNER_SCOPES = [
  "menu:read",
  "orders:write",
  "orders:read",
  "payments:write",
  "requests:write",
  "realtime:subscribe",
] as const;

export type PartnerScope = (typeof PARTNER_SCOPES)[number];

export function isPartnerScope(value: string): value is PartnerScope {
  return (PARTNER_SCOPES as readonly string[]).includes(value);
}
