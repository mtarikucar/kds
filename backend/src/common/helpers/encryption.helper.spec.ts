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

  describe('v2 context binding (AAD)', () => {
    const CTX = 'camera:streamUrl:tenant-A';

    it('encryptString with a context emits v2 and round-trips with the same context', () => {
      const blob = encryptString('rtsp://u:p@cam', CTX);
      expect(blob.startsWith('v2:')).toBe(true);
      expect(decryptString(blob, CTX)).toBe('rtsp://u:p@cam');
    });

    it('REJECTS a v2 blob decrypted with a DIFFERENT context (cross-tenant substitution)', () => {
      // The exact attack: tenant A's ciphertext pasted into tenant B's row.
      const stolen = encryptString('rtsp://u:p@cam', 'camera:streamUrl:tenant-A');
      expect(() =>
        decryptString(stolen, 'camera:streamUrl:tenant-B'),
      ).toThrow(DecryptionError);
    });

    it('REJECTS a v2 blob decrypted with NO context', () => {
      const blob = encryptString('secret', CTX);
      expect(() => decryptString(blob)).toThrow(DecryptionError);
    });

    it('ignores a passed context for a legacy v1 blob (backwards compatible — existing rows keep working)', () => {
      const legacy = encryptString('old-token'); // v1, written before binding
      expect(legacy.startsWith('v1:')).toBe(true);
      // A read site that now passes context must still decrypt the old row.
      expect(decryptString(legacy, CTX)).toBe('old-token');
    });

    it('encryptJson/decryptJson bind context symmetrically and reject a mismatch', () => {
      const enc = encryptJson({ token: 'abc' }, CTX);
      expect(enc.v).toBe(2);
      expect(decryptJson(enc, CTX)).toEqual({ token: 'abc' });
      expect(() => decryptJson(enc, 'wrong-ctx')).toThrow(DecryptionError);
      // Legacy JSON payload (no v) decrypts with context ignored.
      const legacy = encryptJson({ token: 'xyz' });
      expect((legacy as any).v).toBeUndefined();
      expect(decryptJson(legacy, CTX)).toEqual({ token: 'xyz' });
    });
  });
});
