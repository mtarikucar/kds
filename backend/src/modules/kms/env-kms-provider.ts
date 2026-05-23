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
 */
@Injectable()
export class EnvKmsProvider implements KmsProvider {
  readonly id = 'env';

  private deriveKey(context: Record<string, string>): Buffer {
    const base = process.env.INTEGRATION_KEY ?? process.env.KMS_MASTER_KEY ?? 'dev-only-do-not-use-in-prod';
    // Sorted context so order-of-keys doesn't matter to the receiver.
    const ctx = Object.keys(context)
      .sort()
      .map((k) => `${k}=${context[k]}`)
      .join('|');
    return createHash('sha256').update(`${base}::${ctx}`).digest();
  }

  /**
   * Stable AAD string built from context. Tied to the key derivation
   * inputs so any mismatch causes decrypt to throw — the same guarantee
   * AWS KMS gets from its encryption context.
   */
  private aad(context: Record<string, string>): Buffer {
    const ctx = Object.keys(context)
      .sort()
      .map((k) => `${k}=${context[k]}`)
      .join('|');
    return Buffer.from(ctx, 'utf8');
  }

  async encrypt({ context, plaintext }: KmsEncryptInput): Promise<Buffer> {
    const key = this.deriveKey(context);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(this.aad(context));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: iv (12) || tag (16) || ct
    return Buffer.concat([iv, tag, ct]);
  }

  async decrypt({ context, ciphertext }: KmsDecryptInput): Promise<string> {
    const key = this.deriveKey(context);
    const iv = ciphertext.subarray(0, 12);
    const tag = ciphertext.subarray(12, 28);
    const ct = ciphertext.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(this.aad(context));
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
