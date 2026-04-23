import {
  DecryptionError,
  decryptJson,
  encryptJson,
  decryptString,
  encryptString,
} from './encryption.helper';

describe('encryption.helper', () => {
  const originalKey = process.env.ENCRYPTION_MASTER_KEY;

  beforeAll(() => {
    process.env.ENCRYPTION_MASTER_KEY = 'test-master-key-at-least-32-chars-long-xx';
  });

  afterAll(() => {
    if (originalKey === undefined) {
      delete process.env.ENCRYPTION_MASTER_KEY;
    } else {
      process.env.ENCRYPTION_MASTER_KEY = originalKey;
    }
  });

  it('round-trips a JSON payload', () => {
    const value = { apiKey: 'secret', nested: { n: 42 } };
    const encrypted = encryptJson(value);
    const decrypted = decryptJson<typeof value>(encrypted);
    expect(decrypted).toEqual(value);
  });

  it('throws DecryptionError on tampered ciphertext (auth tag mismatch)', () => {
    const encrypted = encryptJson({ secret: 'hello' });
    const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -2) + 'AA' };
    expect(() => decryptJson(tampered)).toThrow(DecryptionError);
  });

  it('throws DecryptionError on garbage base64 inputs', () => {
    expect(() =>
      decryptJson({ iv: 'not-base64!!!', authTag: 'x', ciphertext: 'x' }),
    ).toThrow(DecryptionError);
  });

  it('encryptString round-trips via decryptString', () => {
    const blob = encryptString('super-secret-token');
    expect(blob.startsWith('v1:')).toBe(true);
    expect(decryptString(blob)).toBe('super-secret-token');
  });

  it('decryptString returns legacy plaintext unchanged when v1 prefix missing', () => {
    expect(decryptString('legacy-plain-token')).toBe('legacy-plain-token');
  });
});
