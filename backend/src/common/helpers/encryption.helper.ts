import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * AES-256-GCM envelope encryption for sensitive at-rest data (delivery
 * platform API keys, access tokens, future secrets). The master key
 * comes from the ENCRYPTION_MASTER_KEY env var — minimum 32 bytes; we
 * hash it to 32 bytes deterministically so operators can provide any
 * string and still land on a valid AES-256 key.
 *
 * Format on disk: `{ ciphertext, iv, authTag }`, all base64url.
 */
export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function requireMasterKey(): Buffer {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_MASTER_KEY is not configured — cannot encrypt/decrypt secrets',
    );
  }
  if (raw.length < 32) {
    throw new Error('ENCRYPTION_MASTER_KEY must be at least 32 chars');
  }
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function encryptJson(value: unknown): EncryptedPayload {
  const key = requireMasterKey();
  const iv = randomBytes(12); // GCM standard nonce size
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  };
}

export function decryptJson<T = unknown>(payload: EncryptedPayload): T {
  const key = requireMasterKey();
  const iv = Buffer.from(payload.iv, 'base64url');
  const authTag = Buffer.from(payload.authTag, 'base64url');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as any).ciphertext === 'string' &&
    typeof (value as any).iv === 'string' &&
    typeof (value as any).authTag === 'string'
  );
}

export function encryptString(value: string): string {
  // Convenience wrapper that returns a single compact string so it fits
  // into existing TEXT columns (accessToken) without a schema change.
  const payload = encryptJson(value);
  return `v1:${payload.iv}:${payload.authTag}:${payload.ciphertext}`;
}

export function decryptString(blob: string): string {
  if (!blob.startsWith('v1:')) {
    // Legacy plaintext — accept during migration but warn.
    return blob;
  }
  const [, iv, authTag, ciphertext] = blob.split(':');
  return decryptJson<string>({ iv, authTag, ciphertext });
}
