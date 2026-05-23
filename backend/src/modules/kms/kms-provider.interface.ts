// Provider-neutral KMS contract used by every module that holds at-rest
// credentials (integration-gateway, future PII storage, future bridge
// signing keys).
//
// The interface is deliberately small — encrypt + decrypt only — because
// that's the only surface 90% of HummyTummy needs. Key rotation, audit
// logs, and quorum approvals live in the operational KMS itself (AWS KMS,
// Vault, GCP KMS) and are accessed via that provider's console, not via
// our service.

export interface KmsEncryptInput {
  /**
   * Per-call context — used as Additional Authenticated Data so a leaked
   * ciphertext + wrong tenant can't be decrypted. Typically
   * { tenantId, purpose } so per-tenant blast radius is limited.
   */
  context: Record<string, string>;
  plaintext: string;
}

export interface KmsDecryptInput {
  context: Record<string, string>;
  ciphertext: Buffer;
}

export interface KmsProvider {
  readonly id: string;
  encrypt(input: KmsEncryptInput): Promise<Buffer>;
  decrypt(input: KmsDecryptInput): Promise<string>;
  /** Optional rotation hook — called by ops when a key version retires. */
  rotate?(context: Record<string, string>): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; details?: Record<string, unknown> }>;
}
