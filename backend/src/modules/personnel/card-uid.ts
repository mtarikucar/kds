import { createHmac } from "crypto";

/**
 * Pure card-UID helpers. No IO, no Nest, no Prisma — so the rotation script
 * (§8 Risk 12) can import them standalone.
 *
 * WHY HMAC AND NOT sha256. The house style for deterministic identity hashes
 * is a bare sha256 (partner-api-key.service.ts:42-44, local-bridge.service.ts:
 * 50). A card UID is different: it carries about 32 bits of entropy, so a bare
 * digest is exhaustible in seconds from a database dump. The pepper is derived
 * from ENCRYPTION_MASTER_KEY, which is not in the dump.
 *
 * WHY tenantId IS IN THE INPUT. The same physical card handed to two tenants
 * must not produce the same stored value — otherwise a dump correlates staff
 * across customers. It is also what makes @@unique([tenantId,
 * staffCardUidHash]) a per-tenant uniqueness rule rather than a global one.
 */

/** Bumped only when the hashing scheme itself changes. */
export const STAFF_CARD_HASH_VERSION = 1;

/**
 * One canonical form for a UID, whatever the reader wrote.
 *
 * Cheap USB HID readers emit the same card as 10-digit decimal, 8/14-digit
 * hex, colon- or space-separated, upper or lower case. Two spellings hashing
 * differently surfaces to the staff member as "card not recognised".
 */
export function normalizeCardUid(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** 4..32 characters AFTER normalization. */
export function isValidCardUid(v: string): boolean {
  const n = normalizeCardUid(v);
  return n.length >= 4 && n.length <= 32;
}

/** Peppered, tenant-scoped HMAC of the normalised UID. */
export function cardUidHash(tenantId: string, uid: string): string {
  const key = process.env.ENCRYPTION_MASTER_KEY;
  if (!key) {
    // Hashing under "" would produce a value that looks fine, matches nothing
    // written under the real key, and silently unenrols every card.
    throw new Error(
      "ENCRYPTION_MASTER_KEY is not configured — cannot hash a staff card UID",
    );
  }
  return createHmac("sha256", key)
    .update(`staffcard:v1:${tenantId}:${normalizeCardUid(uid)}`)
    .digest("hex");
}

/** The ONLY part of a UID that may ever be displayed or logged. */
export function cardUidLast4(uid: string): string {
  return normalizeCardUid(uid).slice(-4);
}

/**
 * AAD for the reversible copy in `users.staffCardUidEnc`. Binding to tenant
 * AND user means a ciphertext moved to another row fails the GCM tag instead
 * of decrypting into someone else's card.
 */
export function staffCardAad(tenantId: string, userId: string): string {
  return `staffcard:v1:${tenantId}:${userId}`;
}
