import { createHmac } from 'node:crypto';
import { verifyHmacHex } from './sig-verify';

/**
 * Targeted regression spec for the shared signed-webhook helper. Every
 * delivery adapter (Yemeksepeti, Getir, Trendyol Yemek, Migros) calls
 * verifyHmacHex; a regression here turns into "any webhook with a
 * 'plausible-looking' signature gets accepted as authentic", which is
 * the worst-shape bug a webhook receiver can have.
 *
 * Two security properties the helper claims (per its own doc):
 *   (a) Non-hex providers (junk strings, truncated hex, raw bytes) get
 *       rejected up front instead of falling through to a
 *       Buffer.from-induced byte mismatch.
 *   (b) Length mismatch returns false but still spends roughly the same
 *       CPU as a real compare, so an attacker can't time-probe to learn
 *       the expected signature length.
 *
 * Property (b) is hard to verify deterministically in a unit test
 * (timing is non-deterministic), so we pin the OBSERVABLE side: it
 * always returns false on mismatched lengths and never throws.
 */
describe('verifyHmacHex (signed-webhook constant-time compare)', () => {
  // Build a real HMAC pair to validate the happy path against the live
  // crypto primitive, not a mock.
  const secret = 'whs_test_secret';
  const body = '{"event":"order.created"}';
  const validSig = createHmac('sha256', secret).update(body).digest('hex');

  it('accepts a matching signature pair', () => {
    expect(verifyHmacHex(validSig, validSig)).toBe(true);
  });

  it('accepts the same signature with a "sha256=" prefix on the provided side', () => {
    // Stripe-style header convention: `sha256=<hex>`.
    expect(verifyHmacHex(validSig, `sha256=${validSig}`)).toBe(true);
    expect(verifyHmacHex(validSig, `SHA256=${validSig}`)).toBe(true); // case-insensitive
  });

  it('is case-insensitive on hex digits', () => {
    expect(verifyHmacHex(validSig.toUpperCase(), validSig.toLowerCase())).toBe(true);
  });

  it('trims surrounding whitespace before comparing', () => {
    expect(verifyHmacHex(validSig, `  ${validSig}  `)).toBe(true);
  });

  it('rejects when the provided signature differs by one byte', () => {
    // Flip the last hex nibble.
    const tampered = validSig.slice(0, -1) + (validSig.endsWith('0') ? '1' : '0');
    expect(verifyHmacHex(validSig, tampered)).toBe(false);
  });

  // -- Pre-Buffer.from safety net -------------------------------------

  it('rejects non-hex providers without throwing', () => {
    // Buffer.from(..., 'hex') silently drops invalid bytes — the
    // explicit /^[0-9a-f]+$/ check shuts that down before the compare.
    expect(verifyHmacHex(validSig, 'not-a-hex-string')).toBe(false);
    expect(verifyHmacHex(validSig, '!@#$%^&*()')).toBe(false);
    expect(verifyHmacHex(validSig, 'gg' + validSig.slice(2))).toBe(false); // g is out of hex
  });

  it('rejects odd-length hex (invalid encoding) without throwing', () => {
    expect(verifyHmacHex(validSig, validSig.slice(0, -1))).toBe(false);
  });

  it('rejects empty string providers', () => {
    expect(verifyHmacHex(validSig, '')).toBe(false);
  });

  // -- Length-mismatch path -------------------------------------------

  it('returns false (not throws) when provided is shorter than expected', () => {
    // The length-mismatch branch intentionally spends time on a
    // constant-time mismatch compare and swallows the throw. The
    // observable side is that we always get `false` and never an
    // uncaught error.
    const short = validSig.slice(0, 32); // 16 bytes vs 32 bytes
    expect(() => verifyHmacHex(validSig, short)).not.toThrow();
    expect(verifyHmacHex(validSig, short)).toBe(false);
  });

  it('returns false (not throws) when provided is longer than expected', () => {
    const long = validSig + 'aa';
    expect(() => verifyHmacHex(validSig, long)).not.toThrow();
    expect(verifyHmacHex(validSig, long)).toBe(false);
  });

  // -- The classic bypass attempts ------------------------------------

  it('rejects an all-zeros signature (forced-mismatch with no info leak)', () => {
    const zeros = '0'.repeat(validSig.length);
    expect(verifyHmacHex(validSig, zeros)).toBe(false);
  });

  it('rejects an attacker-supplied repeated-byte pattern', () => {
    // A naïve string-prefix compare could leak via early bail; the
    // helper goes through timingSafeEqual which won't.
    const pattern = 'ab'.repeat(validSig.length / 2);
    expect(verifyHmacHex(validSig, pattern)).toBe(false);
  });

  it('still rejects when the prefix is "sha256=" but the rest is garbage', () => {
    expect(verifyHmacHex(validSig, 'sha256=not-hex')).toBe(false);
  });
});
