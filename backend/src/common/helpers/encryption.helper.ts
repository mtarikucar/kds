import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

/**
 * AES-256-GCM envelope encryption for sensitive at-rest data (delivery
 * platform API keys, access tokens, camera stream URLs, future secrets).
 * The master key comes from the ENCRYPTION_MASTER_KEY env var — minimum
 * 32 bytes; we hash it to 32 bytes deterministically so operators can
 * provide any string and still land on a valid AES-256 key.
 *
 * Format on disk: `{ ciphertext, iv, authTag }`, all base64url; the
 * compact string form is `v1:iv:authTag:ciphertext`.
 *
 * CONTEXT BINDING (v2): a plain GCM tag proves a ciphertext hasn't been
 * *altered*, but not that it belongs where it sits — an attacker with DB
 * write access could paste tenant A's encrypted camera URL / token into
 * tenant B's row and the tag still verifies (same master key, no
 * provenance). Passing a `context` binds the ciphertext to that string as
 * AAD (Additional Authenticated Data): decrypting with a different context
 * fails the tag, so a moved blob is rejected. This mirrors the KMS
 * provider's AAD binding. Backwards-compatible: no context → v1 (unchanged
 * on disk); v1 blobs decrypt with the context IGNORED, so existing rows
 * keep working and upgrade to v2 on their next write. `v` discriminates the
 * structured form; the `v2:` prefix discriminates the string form.
 */
export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  /** 2 = AAD/context-bound. Absent/1 = legacy, no context. */
  v?: 2;
}

/**
 * Domain-specific error for decryption failures so callers can catch
 * ciphertext corruption / tampered payloads separately from genuine
 * programmer bugs without swallowing everything as `Error`.
 */
export class DecryptionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DecryptionError";
  }
}

function requireMasterKey(): Buffer {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_MASTER_KEY is not configured — cannot encrypt/decrypt secrets",
    );
  }
  if (raw.length < 32) {
    throw new Error("ENCRYPTION_MASTER_KEY must be at least 32 chars");
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptJson(
  value: unknown,
  context?: string,
): EncryptedPayload {
  const key = requireMasterKey();
  const iv = randomBytes(12); // GCM standard nonce size
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (context) cipher.setAAD(Buffer.from(context, "utf8"));
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    ...(context ? { v: 2 as const } : {}),
  };
}

export function decryptJson<T = unknown>(
  payload: EncryptedPayload,
  context?: string,
): T {
  const key = requireMasterKey();

  // Any of the steps below can throw on corrupted / tampered ciphertext:
  // - `setAuthTag` with wrong length bytes
  // - `decipher.final()` when GCM auth tag doesn't match (tampered payload,
  //   OR a v2 blob decrypted with the wrong/absent context → rejected)
  // - `JSON.parse` if the decrypted bytes aren't valid JSON (key rotated
  //   without re-encrypting, or the column was written by a different
  //   codepath). One unhandled throw used to kill the whole request with
  //   a raw crypto stack trace.
  let plaintext: Buffer;
  try {
    const iv = Buffer.from(payload.iv, "base64url");
    const authTag = Buffer.from(payload.authTag, "base64url");
    const ciphertext = Buffer.from(payload.ciphertext, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    // Only v2 blobs are context-bound. A legacy v1 blob (no `v`) MUST decrypt
    // with the context ignored so pre-existing rows keep working; a v2 blob
    // MUST bind the caller's context so a moved ciphertext fails the tag.
    if (payload.v === 2) decipher.setAAD(Buffer.from(context ?? "", "utf8"));
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (cause) {
    throw new DecryptionError(
      "Failed to decrypt payload (corrupted ciphertext, wrong key, tampered auth tag, or context mismatch)",
      cause,
    );
  }

  try {
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch (cause) {
    throw new DecryptionError("Decrypted payload is not valid JSON", cause);
  }
}

export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as any).ciphertext === "string" &&
    typeof (value as any).iv === "string" &&
    typeof (value as any).authTag === "string"
  );
}

export function encryptString(value: string, context?: string): string {
  // Convenience wrapper that returns a single compact string so it fits
  // into existing TEXT columns (accessToken, streamUrl) without a schema
  // change. `v2:` marks a context-bound blob; `v1:` stays context-free.
  const payload = encryptJson(value, context);
  const version = context ? "v2" : "v1";
  return `${version}:${payload.iv}:${payload.authTag}:${payload.ciphertext}`;
}

export function decryptString(blob: string, context?: string): string {
  const isV1 = blob.startsWith("v1:");
  const isV2 = blob.startsWith("v2:");
  if (!isV1 && !isV2) {
    // Legacy plaintext — accept during migration but flag once per process
    // so the operator notices unencrypted rows still in the DB.
    warnPlaintextFallback();
    return blob;
  }
  const parts = blob.split(":");
  if (parts.length !== 4) {
    // Defensive: a malformed versioned blob would otherwise feed undefined
    // values into Buffer.from() and surface as a cryptic crypto stack trace.
    throw new DecryptionError(
      `Malformed encrypted blob: expected 4 colon-separated parts, got ${parts.length}`,
    );
  }
  const [, iv, authTag, ciphertext] = parts;
  // A v1 blob decrypts with the context ignored (legacy rows predate
  // binding); a v2 blob binds the caller's context as AAD.
  return decryptJson<string>(
    { iv, authTag, ciphertext, ...(isV2 ? { v: 2 as const } : {}) },
    isV2 ? context : undefined,
  );
}

let _plaintextWarned = false;
function warnPlaintextFallback() {
  if (_plaintextWarned) return;
  _plaintextWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[encryption] decryptString received unencrypted legacy plaintext — " +
      "re-encrypt those rows before disabling the fallback.",
  );
}
