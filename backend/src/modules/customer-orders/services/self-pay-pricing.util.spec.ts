import { BadRequestException } from '@nestjs/common';
import {
  INTENT_TTL_MINUTES,
  selfPayError,
  truncateUtf8,
} from './self-pay-pricing.util';

/**
 * Specs for the self-pay pricing helpers:
 *  - selfPayError builds a 400 with a stable {code,message} body the QR menu
 *    translates via i18n
 *  - truncateUtf8 truncates by UTF-8 BYTE length without splitting a
 *    multi-byte character (Turkish letters / emoji)
 */
describe('INTENT_TTL_MINUTES', () => {
  it('is the 15-minute reservation window', () => {
    expect(INTENT_TTL_MINUTES).toBe(15);
  });
});

describe('selfPayError', () => {
  it('returns a BadRequestException carrying the stable code + message', () => {
    const err = selfPayError('NON_TR_TENANT', 'Bu işletme self-pay desteklemiyor');
    expect(err).toBeInstanceOf(BadRequestException);
    const body = err.getResponse() as any;
    expect(body).toMatchObject({
      code: 'NON_TR_TENANT',
      message: 'Bu işletme self-pay desteklemiyor',
      statusCode: 400,
      error: 'Bad Request',
    });
  });
});

describe('truncateUtf8', () => {
  it('returns "" for empty/falsy input', () => {
    expect(truncateUtf8('', 10)).toBe('');
  });

  it('returns the input unchanged when it fits within maxBytes', () => {
    expect(truncateUtf8('hello', 10)).toBe('hello');
  });

  it('truncates a plain ASCII string to the byte budget', () => {
    expect(truncateUtf8('abcdef', 3)).toBe('abc');
  });

  it('does not split a multi-byte Turkish char at the boundary', () => {
    // "ç" is 2 bytes in UTF-8. Budget of 3 bytes can hold "aç" (1+2) exactly.
    const out = truncateUtf8('aço', 3);
    expect(out).toBe('aç');
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(3);
  });

  it('walks back rather than emit a broken half-character', () => {
    // Budget of 2 bytes cannot hold the leading "a" (1) + half of "ç";
    // it must walk back to a safe boundary -> just "a".
    const out = truncateUtf8('açb', 2);
    expect(out).toBe('a');
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(2);
  });

  it('never emits invalid UTF-8 for an emoji (4-byte char)', () => {
    const out = truncateUtf8('🍕pizza', 3); // 🍕 is 4 bytes; cannot fit in 3
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(3);
    // re-encoding round-trips cleanly (no replacement chars)
    expect(out).toBe(Buffer.from(out, 'utf8').toString('utf8'));
  });
});
