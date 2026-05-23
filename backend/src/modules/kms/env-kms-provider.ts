import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { KmsDecryptInput, KmsEncryptInput, KmsProvider } from './kms-provider.interface';

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
 * Legacy format (pre-versioning, written before this commit) has no
 * envelope byte — `decrypt` falls back to `decryptLegacy` so historical
 * blobs remain readable across the rollout.
 */
const ENVELOPE_VERSION_V1 = 0x01;
const ALGORITHM_AES_256_GCM = 'aes-256-gcm';

@Injectable()
export class EnvKmsProvider implements KmsProvider {
  readonly id = 'env';

  /**
   * Active key version for new encryptions. Read from env so ops can roll
   * forward by setting `KMS_KEY_VERSION=2` plus `KMS_MASTER_KEY_V2`, then
   * historical v1 blobs continue to decrypt with the v1 key derivation.
   */
  private currentVersion(): number {
    const v = Number(process.env.KMS_KEY_VERSION ?? '1');
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
        (process.env.NODE_ENV === 'production' ? null : 'dev-only-do-not-use-in-prod')
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
      .join('|');
    return createHash('sha256').update(`v${version}::${base}::${ctx}`).digest();
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
      .join('|');
    return Buffer.from(`v${version}|${ALGORITHM_AES_256_GCM}|${ctx}`, 'utf8');
  }

  async encrypt({ context, plaintext }: KmsEncryptInput): Promise<Buffer> {
    const version = this.currentVersion();
    const key = this.deriveKey(version, context);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(this.aad(version, context));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([ENVELOPE_VERSION_V1, version]), iv, tag, ct]);
  }

  async decrypt({ context, ciphertext }: KmsDecryptInput): Promise<string> {
    if (ciphertext.length === 0) throw new Error('Empty ciphertext');
    // First byte is the envelope marker; second is the key version. A
    // missing marker means a pre-versioning blob — fall through to the
    // legacy decoder.
    if (ciphertext[0] !== ENVELOPE_VERSION_V1) {
      return this.decryptLegacy(context, ciphertext);
    }
    const version = ciphertext[1];
    const key = this.deriveKey(version, context);
    const iv = ciphertext.subarray(2, 14);
    const tag = ciphertext.subarray(14, 30);
    const ct = ciphertext.subarray(30);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(this.aad(version, context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  /**
   * Pre-versioning decryption: no envelope header, no algorithm tag in
   * the AAD, iv at offset 0. Kept so blobs written before the rotation
   * scheme landed remain decryptable. New encryptions never use this
   * format.
   */
  private decryptLegacy(context: Record<string, string>, ciphertext: Buffer): string {
    const base = this.masterKeyFor(1);
    if (!base) throw new Error('Legacy KMS key not configured');
    const ctx = Object.keys(context)
      .sort()
      .map((k) => `${k}=${context[k]}`)
      .join('|');
    const key = createHash('sha256').update(`${base}::${ctx}`).digest();
    const iv = ciphertext.subarray(0, 12);
    const tag = ciphertext.subarray(12, 28);
    const ct = ciphertext.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(ctx, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  async healthCheck() {
    return {
      ok: Boolean(process.env.INTEGRATION_KEY || process.env.KMS_MASTER_KEY),
      details: { provider: 'env', warning: 'env-derived key — use AWS KMS in production' },
    };
  }
}
