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
});
