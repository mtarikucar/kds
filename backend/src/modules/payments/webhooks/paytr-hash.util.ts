import * as crypto from 'crypto';

export interface CallbackHashInput {
  merchantOid: string;
  merchantSalt: string;
  status: string;
  totalAmount: string;
  merchantKey: string;
}

/**
 * PayTR signs the callback as
 *   HMAC-SHA256(merchantKey, merchantOid + merchantSalt + status + totalAmount).base64()
 * (Reference: PayTR iFrame API "Bildirim URL" docs.)
 */
export function computeCallbackHash(input: CallbackHashInput): string {
  const { merchantOid, merchantSalt, status, totalAmount, merchantKey } = input;
  return crypto
    .createHmac('sha256', merchantKey)
    .update(`${merchantOid}${merchantSalt}${status}${totalAmount}`)
    .digest('base64');
}

export function verifyCallbackHash(
  input: CallbackHashInput & { providedHash: string },
): boolean {
  const expected = computeCallbackHash(input);
  const provided = input.providedHash;
  // timingSafeEqual throws on length mismatch — guard first.
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}
