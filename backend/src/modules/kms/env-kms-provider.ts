import { Injectable } from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  KmsDecryptInput,
  KmsEncryptInput,
  KmsProvider,
  KmsRotateCiphertextInput,
} from "./kms-provider.interface";

/**
 * Env-derived KMS — same scheme that integration-gateway has been using
 * since Phase 11, now exposed behind the KmsProvider interface so other
 * modules can opt in.
 *
 * Key derivation: HKDF-shaped sha256 against the master env var +
 * (sorted) context. Every distinct context yields a distinct key, so a
 * leaked tenant-A ciphertext is useless for tenant-B even if the master
 * env var is shared. Authentication tag verifies both ciphertext integrity
 * and context binding via AAD.
 *
 * Trade-off vs AWS KMS:
 *   ✓ zero cost, zero setup, deterministic in CI.
 *   ✗ master key lives in env — a host compromise leaks every tenant.
 *
 * The AwsKmsProvider (stub) is the recommended posture once the cluster
 * has IAM/KMS access. Swapping is a one-line module config change.
 *
 * Envelope format v1:
 *   byte 0       : envelope version (1)
 *   byte 1       : key version (1, 2, 3 …)
 *   bytes 2..14  : iv (12 bytes)
 *   bytes 14..30 : auth tag (16 bytes)
 *   bytes 30..   : ciphertext
 *
 * No pre-versioning legacy format: the v1 envelope was introduced with
 * this class, before any blob was written via `kms.encrypt()`. A
 * decryptLegacy() helper used to exist as defensive scaffold but
 * collided with v1 blobs whose first byte happened to be 0x01 (1/256
 * of all v1 blobs) — see iter-13 review. Since no producer ever wrote
 * the legacy format, deleting the fallback removes the data-loss risk
 * cleanly. If a future migration imports pre-envelope blobs, add a
 * format flag column on the row (not a magic-byte heuristic).
 */
const ENVELOPE_VERSION_V1 = 0x01;
const ALGORITHM_AES_256_GCM = "aes-256-gcm";

@Injectable()
export class EnvKmsProvider implements KmsProvider {
  readonly id = "env";

  /**
   * Active key version for new encryptions. Read from env so ops can roll
   * forward by setting `KMS_KEY_VERSION=2` plus `KMS_MASTER_KEY_V2`, then
   * historical v1 blobs continue to decrypt with the v1 key derivation.
   */
  private currentVersion(): number {
    const v = Number(process.env.KMS_KEY_VERSION ?? "1");
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 1;
  }

  /**
   * Resolve the master-key string for a specific version. Returning null
   * forces a hard error at the call site rather than silently decrypting
   * with the wrong key.
   *   v=1 → INTEGRATION_KEY or KMS_MASTER_KEY (back-compat)
   *   v=N → KMS_MASTER_KEY_V<N>
   */
  private masterKeyFor(version: number): string | null {
    if (version === 1) {
      return (
        process.env.INTEGRATION_KEY ??
        process.env.KMS_MASTER_KEY ??
        (process.env.NODE_ENV === "production"
          ? null
          : "dev-only-do-not-use-in-prod")
      );
    }
    return process.env[`KMS_MASTER_KEY_V${version}`] ?? null;
  }

  private deriveKey(version: number, context: Record<string, string>): Buffer {
    const base = this.masterKeyFor(version);
    if (!base) {
      throw new Error(`No master key configured for KMS version ${version}`);
    }
    const ctx = Object.keys(context)
      .sort()
      .map((k) => `${k}=${context[k]}`)
      .join("|");
    return createHash("sha256").update(`v${version}::${base}::${ctx}`).digest();
  }

  /**
   * AAD includes the envelope version AND the algorithm so a downgrade
   * attack ("decrypt this v2 ciphertext as v1") fails at the auth-tag
   * check rather than silently using a weaker scheme.
   */
  private aad(version: number, context: Record<string, string>): Buffer {
    const ctx = Object.keys(context)
      .sort()
      .map((k) => `${k}=${context[k]}`)
      .join("|");
    return Buffer.from(`v${version}|${ALGORITHM_AES_256_GCM}|${ctx}`, "utf8");
  }

  async encrypt({ context, plaintext }: KmsEncryptInput): Promise<Buffer> {
    const version = this.currentVersion();
    const key = this.deriveKey(version, context);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(this.aad(version, context));
    const ct = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([
      Buffer.from([ENVELOPE_VERSION_V1, version]),
      iv,
      tag,
      ct,
    ]);
  }

  async decrypt({ context, ciphertext }: KmsDecryptInput): Promise<string> {
    if (ciphertext.length === 0) throw new Error("Empty ciphertext");
    // First byte must be the v1 envelope marker. Previously a non-v1 byte
    // would fall through to a legacy decoder that collided with the
    // 1/256 of real v1 blobs whose IV began with a non-0x01 byte — wait,
    // the inverse: legacy blobs starting with 0x01 hit the v1 path and
    // failed tag check, masquerading as data corruption. Since no
    // producer in this codebase ever wrote the legacy format, refuse
    // unknown markers explicitly.
    if (ciphertext[0] !== ENVELOPE_VERSION_V1) {
      throw new Error(
        `Unknown KMS envelope version: 0x${ciphertext[0].toString(16)}`,
      );
    }
    const version = ciphertext[1];
    const key = this.deriveKey(version, context);
    const iv = ciphertext.subarray(2, 14);
    const tag = ciphertext.subarray(14, 30);
    const ct = ciphertext.subarray(30);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(this.aad(version, context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8",
    );
  }

  /**
   * Re-wrap one ciphertext under the current key version.
   *
   * Per-blob primitive for an ops rotation job: walk each row holding a
   * `secretEnc`, call this, persist the result. Three invariants make it
   * safe to run against live data:
   *
   *   1. Idempotent — if the blob's embedded key version already equals the
   *      current version, the *same bytes* are returned. No decrypt/encrypt,
   *      no IV churn, so a re-run (or a half-finished job resumed) is a true
   *      no-op and the caller can skip the DB write.
   *
   *   2. Verify-before-persist — after re-encrypting, the new blob is
   *      decrypted back and asserted byte-for-byte equal to the original
   *      plaintext *before* it is returned. A derivation/key misconfig can
   *      therefore never hand the caller a blob that would overwrite a good
   *      secret with something undecryptable.
   *
   *   3. Fail-closed — a source blob that can't be decrypted (corruption,
   *      wrong context, retired key) throws; nothing is emitted. The caller
   *      leaves the existing `secretEnc` untouched.
   *
   * Note: re-encryption goes through `encrypt()`, which always stamps the
   * *current* version, so a v1 blob lands directly at v3 in one hop when the
   * provider's current version is 3 — no chained intermediate re-wraps.
   */
  async rotateCiphertext({
    context,
    ciphertext,
  }: KmsRotateCiphertextInput): Promise<Buffer> {
    if (ciphertext.length === 0) throw new Error("Empty ciphertext");
    if (ciphertext[0] !== ENVELOPE_VERSION_V1) {
      throw new Error(
        `Unknown KMS envelope version: 0x${ciphertext[0].toString(16)}`,
      );
    }

    const blobVersion = ciphertext[1];
    const target = this.currentVersion();

    // (1) Idempotent: already current — return identical bytes, no work.
    if (blobVersion === target) {
      return Buffer.from(ciphertext);
    }

    // Decrypt with the old embedded version (decrypt() reads byte 1 itself).
    // Throws on corruption / wrong context / missing old key → fail-closed.
    const plaintext = await this.decrypt({ context, ciphertext });

    // Re-encrypt under the current version (encrypt() stamps currentVersion()).
    const rotated = await this.encrypt({ context, plaintext });

    // (2) Verify-before-persist: decrypt the fresh blob back and confirm it
    // matches the original plaintext. Only then is it safe to return.
    const verified = await this.decrypt({ context, ciphertext: rotated });
    if (verified !== plaintext) {
      throw new Error(
        "KMS rotateCiphertext verification failed — re-encrypted blob did not " +
          "round-trip to the original plaintext; refusing to persist.",
      );
    }

    return rotated;
  }

  async healthCheck() {
    return {
      ok: Boolean(process.env.INTEGRATION_KEY || process.env.KMS_MASTER_KEY),
      details: {
        provider: "env",
        warning: "env-derived key — use AWS KMS in production",
      },
    };
  }
}
