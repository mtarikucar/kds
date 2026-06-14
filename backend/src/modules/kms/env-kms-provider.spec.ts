import { EnvKmsProvider } from './env-kms-provider';

/**
 * Round-trip + tamper detection + context binding.
 *
 * Context binding is the security-critical bit: ciphertext encrypted for
 * tenant A must fail to decrypt under tenant B's context, even if the
 * master env key is shared.
 */
describe('EnvKmsProvider', () => {
  let provider: EnvKmsProvider;

  beforeEach(() => {
    process.env.INTEGRATION_KEY = 'spec-master-key';
    provider = new EnvKmsProvider();
  });

  it('encrypts and decrypts back to itself', async () => {
    const ct = await provider.encrypt({ context: { tenantId: 't1' }, plaintext: 'hello' });
    const pt = await provider.decrypt({ context: { tenantId: 't1' }, ciphertext: ct });
    expect(pt).toBe('hello');
  });

  it('produces a different ciphertext on every call (random IV)', async () => {
    const a = await provider.encrypt({ context: { tenantId: 't1' }, plaintext: 'same' });
    const b = await provider.encrypt({ context: { tenantId: 't1' }, plaintext: 'same' });
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('refuses to decrypt under a different context', async () => {
    const ct = await provider.encrypt({ context: { tenantId: 't1' }, plaintext: 'secret' });
    await expect(
      provider.decrypt({ context: { tenantId: 't2' }, ciphertext: ct }),
    ).rejects.toThrow();
  });

  it('refuses to decrypt tampered ciphertext', async () => {
    // Plaintext is intentionally long so we can tamper inside the ciphertext
    // body (after iv:12 + tag:16) and still hit a real byte.
    const longPlain = 'this is a longer secret string used so tampering hits actual bytes';
    const ct = Buffer.from(await provider.encrypt({ context: { tenantId: 't1' }, plaintext: longPlain }));
    ct[40] = ct[40] ^ 0x01;
    await expect(
      provider.decrypt({ context: { tenantId: 't1' }, ciphertext: ct }),
    ).rejects.toThrow();
  });

  it('context is order-independent', async () => {
    const ct = await provider.encrypt({
      context: { tenantId: 't1', purpose: 'integration' },
      plaintext: 'secret',
    });
    const pt = await provider.decrypt({
      context: { purpose: 'integration', tenantId: 't1' },   // keys reversed
      ciphertext: ct,
    });
    expect(pt).toBe('secret');
  });

  it('versioned envelope decrypts with the matching master key', async () => {
    process.env.KMS_KEY_VERSION = '2';
    process.env.KMS_MASTER_KEY_V2 = 'spec-v2-key';
    provider = new EnvKmsProvider();
    const ct = await provider.encrypt({ context: { tenantId: 't1' }, plaintext: 'v2-blob' });
    const pt = await provider.decrypt({ context: { tenantId: 't1' }, ciphertext: ct });
    expect(pt).toBe('v2-blob');
    // Cleanup so later tests in this suite don't inherit v2.
    delete process.env.KMS_KEY_VERSION;
    delete process.env.KMS_MASTER_KEY_V2;
  });

  it('decrypts both v1 and v2 ciphertexts after rotation', async () => {
    // Encrypt under v1, rotate to v2, encrypt again, then confirm both
    // ciphertexts round-trip — the version byte in the envelope tells
    // the decoder which key derivation to use.
    process.env.KMS_KEY_VERSION = '1';
    provider = new EnvKmsProvider();
    const ctV1 = await provider.encrypt({ context: { tenantId: 't1' }, plaintext: 'v1-blob' });

    process.env.KMS_KEY_VERSION = '2';
    process.env.KMS_MASTER_KEY_V2 = 'spec-v2-key';
    provider = new EnvKmsProvider();
    const ctV2 = await provider.encrypt({ context: { tenantId: 't1' }, plaintext: 'v2-blob' });

    expect(await provider.decrypt({ context: { tenantId: 't1' }, ciphertext: ctV1 })).toBe('v1-blob');
    expect(await provider.decrypt({ context: { tenantId: 't1' }, ciphertext: ctV2 })).toBe('v2-blob');
    delete process.env.KMS_KEY_VERSION;
    delete process.env.KMS_MASTER_KEY_V2;
  });

  describe('rotateCiphertext', () => {
    const ctx = { tenantId: 't1', purpose: 'webhook' };

    afterEach(() => {
      delete process.env.KMS_KEY_VERSION;
      delete process.env.KMS_MASTER_KEY_V2;
      delete process.env.KMS_MASTER_KEY_V3;
    });

    it('re-encrypts an old-version blob to the current version and round-trips', async () => {
      // Write a v1 blob, then bring up a provider whose current version is 2.
      process.env.KMS_KEY_VERSION = '1';
      provider = new EnvKmsProvider();
      const ctV1 = await provider.encrypt({ context: ctx, plaintext: 'topsecret' });
      expect(ctV1[1]).toBe(1); // key-version byte

      process.env.KMS_KEY_VERSION = '2';
      process.env.KMS_MASTER_KEY_V2 = 'spec-v2-key';
      provider = new EnvKmsProvider();

      const rotated = await provider.rotateCiphertext({ context: ctx, ciphertext: ctV1 });
      // The rotated blob carries the new key-version in its envelope...
      expect(rotated[1]).toBe(2);
      // ...is a genuinely different blob (re-encrypted, not the same bytes)...
      expect(Buffer.compare(rotated, ctV1)).not.toBe(0);
      // ...and decrypts back to the original plaintext under the same context.
      expect(await provider.decrypt({ context: ctx, ciphertext: rotated })).toBe('topsecret');
    });

    it('is idempotent — rotating an already-current blob is a no-op (same bytes)', async () => {
      process.env.KMS_KEY_VERSION = '2';
      process.env.KMS_MASTER_KEY_V2 = 'spec-v2-key';
      provider = new EnvKmsProvider();
      const ctV2 = await provider.encrypt({ context: ctx, plaintext: 'already-current' });
      expect(ctV2[1]).toBe(2);

      const rotated = await provider.rotateCiphertext({ context: ctx, ciphertext: ctV2 });
      // Already at the current version: return the exact same bytes so a
      // re-run of a rotation job is a true no-op (no write, no IV churn).
      expect(Buffer.compare(rotated, ctV2)).toBe(0);
      // Re-running again is still a no-op and still decrypts.
      const rotatedAgain = await provider.rotateCiphertext({ context: ctx, ciphertext: rotated });
      expect(Buffer.compare(rotatedAgain, ctV2)).toBe(0);
      expect(await provider.decrypt({ context: ctx, ciphertext: rotatedAgain })).toBe('already-current');
    });

    it('verify-before-persist: a corrupted source blob throws and yields no output', async () => {
      // Tamper an old-version blob so it cannot be decrypted. rotate must
      // surface the failure rather than emit a blob that would overwrite a
      // good secretEnc with garbage.
      process.env.KMS_KEY_VERSION = '1';
      provider = new EnvKmsProvider();
      const longPlain = 'a sufficiently long secret so tampering lands on a real ciphertext byte';
      const ctV1 = Buffer.from(await provider.encrypt({ context: ctx, plaintext: longPlain }));

      process.env.KMS_KEY_VERSION = '2';
      process.env.KMS_MASTER_KEY_V2 = 'spec-v2-key';
      provider = new EnvKmsProvider();

      ctV1[40] = ctV1[40] ^ 0x01; // flip a body byte → auth-tag check fails
      await expect(
        provider.rotateCiphertext({ context: ctx, ciphertext: ctV1 }),
      ).rejects.toThrow();
    });

    it('verify-before-persist: a wrong context throws instead of producing a blob', async () => {
      // Even if the source blob is intact, rotating it under the wrong
      // context (which can't decrypt it) must fail closed.
      process.env.KMS_KEY_VERSION = '1';
      provider = new EnvKmsProvider();
      const ctV1 = await provider.encrypt({ context: ctx, plaintext: 'cross-tenant' });

      process.env.KMS_KEY_VERSION = '2';
      process.env.KMS_MASTER_KEY_V2 = 'spec-v2-key';
      provider = new EnvKmsProvider();

      await expect(
        provider.rotateCiphertext({
          context: { tenantId: 'OTHER', purpose: 'webhook' },
          ciphertext: ctV1,
        }),
      ).rejects.toThrow();
    });

    it('rotates across multiple versions (v1 → v3) in one hop', async () => {
      process.env.KMS_KEY_VERSION = '1';
      provider = new EnvKmsProvider();
      const ctV1 = await provider.encrypt({ context: ctx, plaintext: 'multi-hop' });

      process.env.KMS_KEY_VERSION = '3';
      process.env.KMS_MASTER_KEY_V3 = 'spec-v3-key';
      provider = new EnvKmsProvider();

      const rotated = await provider.rotateCiphertext({ context: ctx, ciphertext: ctV1 });
      expect(rotated[1]).toBe(3);
      expect(await provider.decrypt({ context: ctx, ciphertext: rotated })).toBe('multi-hop');
    });
  });
});
