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

export interface KmsRotateCiphertextInput {
  context: Record<string, string>;
  /** A ciphertext previously produced by this provider's `encrypt()`. */
  ciphertext: Buffer;
}

export interface KmsProvider {
  readonly id: string;
  encrypt(input: KmsEncryptInput): Promise<Buffer>;
  decrypt(input: KmsDecryptInput): Promise<string>;
  /** Optional rotation hook — called by ops when a key version retires. */
  rotate?(context: Record<string, string>): Promise<void>;
  /**
   * Re-wrap a single ciphertext under the provider's *current* key version.
   *
   * This is the per-blob primitive an operational rotation job runs against
   * each persisted secret (e.g. `secretEnc`): decrypt with the old embedded
   * key version, re-encrypt with the current one. Implementations MUST be
   *   • idempotent  — a blob already at the current version is returned
   *     unchanged (same bytes) so re-running the job is a true no-op; and
   *   • verify-before-persist — the freshly produced blob is decrypted back
   *     and checked against the original plaintext before being returned, so
   *     a failed rotation throws rather than emitting a blob that could
   *     overwrite a good secret with garbage.
   *
   * Optional: providers that delegate rotation to the backing KMS (e.g. AWS)
   * may leave this undefined.
   */
  rotateCiphertext?(input: KmsRotateCiphertextInput): Promise<Buffer>;
  healthCheck(): Promise<{ ok: boolean; details?: Record<string, unknown> }>;
}
