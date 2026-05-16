import { createHash, randomBytes, randomInt } from 'crypto';

/**
 * Normalize a phone number to a canonical form so duplicate detection under
 * the @@unique([tenantId, phone]) constraint works across whitespace /
 * punctuation variations that end users commonly type.
 *
 * Turkish numbers come in three equivalent shapes that previously hashed to
 * three different rows under the unique constraint — splitting one customer
 * across three loyalty wallets:
 *   "05551234567"         (national, 11 digits, leading 0)
 *   "905551234567"        (E.164 without +)
 *   "+90 555 123 4567"    (E.164 canonical)
 * All three collapse to "+905551234567" here. International numbers retain
 * a leading + if the caller already provided one; otherwise fall back to
 * the digits-only string (preserves prior behaviour for non-TR locales).
 */
export function normalizePhone(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D+/g, '');
  if (!digits) return trimmed;

  // Turkish mobile/landline always reduce to 10 digits after the country
  // code. The three shapes below are the ones we keep seeing in the wild.
  if (digits.length === 11 && digits.startsWith('0')) {
    return `+90${digits.slice(1)}`;
  }
  if (digits.length === 12 && digits.startsWith('90')) {
    return `+${digits}`;
  }
  if (hasPlus && digits.startsWith('90') && digits.length === 12) {
    return `+${digits}`;
  }

  return hasPlus ? `+${digits}` : digits;
}

/**
 * 6-digit cryptographic OTP. randomInt is a CSPRNG — Math.random is not, and
 * for OTP with only 3 attempts the distribution bias of Math.random actually
 * matters at scale.
 */
export function generateOtp(): string {
  return String(randomInt(100_000, 1_000_000));
}

/**
 * Hash an OTP for at-rest storage. The server secret is mixed in so a DB dump
 * alone is not sufficient to read live codes; and the output is constant-width
 * for constant-time compare.
 */
export function hashOtp(code: string): string {
  const secret = process.env.JWT_SECRET ?? process.env.APP_SECRET ?? '';
  return createHash('sha256').update(`${secret}:${code}`).digest('hex');
}

export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Cryptographically secure base32-ish code used for referral codes.
 * 8 chars from a 32-symbol alphabet = 32^8 = 2^40 codes.
 */
export function generateReferralSuffix(length = 4): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Crockford-ish, no 0/1/I/O
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}
