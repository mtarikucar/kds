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
});
