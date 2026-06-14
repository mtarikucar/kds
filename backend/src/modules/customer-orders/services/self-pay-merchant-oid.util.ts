import { randomBytes } from "crypto";

export const MERCHANT_OID_PREFIX = "SP"; // "SP" — Self-Pay (subscription is "SUB")

/**
 * Mint an unguessable self-pay merchant OID. Shape:
 *   SP<tenantHex(12)><base36 timestamp><6 hex random>
 * The "SP" prefix is what PaytrWebhookController dispatches on; the
 * tenant-hex prefix keeps OIDs roughly tenant-grouped for log triage;
 * the random suffix makes possession sufficient auth for the
 * read-only status poll.
 */
export function generateMerchantOid(tenantId: string): string {
  const tenantHex = tenantId.replace(/-/g, "").slice(0, 12);
  const ts = Date.now().toString(36);
  const rand = randomBytes(3).toString("hex");
  return `${MERCHANT_OID_PREFIX}${tenantHex}${ts}${rand}`;
}
