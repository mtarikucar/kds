import { BadRequestException } from "@nestjs/common";

// Self-pay intent reservation window. PayTR 3DS step + customer
// hesitation comfortably fit in 15 min; longer windows leave a
// table's items locked from the waiter for an entire turn cycle
// (avg table turn ~45 min). Sweeper runs every 30 min, but lazy
// expire on the polling read makes the practical limit ≈ TTL.
export const INTENT_TTL_MINUTES = 15;

/**
 * Customer-facing 400 with a stable error code. The QR-menu surfaces
 * `err.response.data.message` directly to the diner; without a code
 * a Turkish customer sees raw English. The frontend looks at
 * `data.code` first, translates via i18n, and falls back to the
 * English message if the code is unknown.
 */
export function selfPayError(code: string, message: string): BadRequestException {
  return new BadRequestException({
    message,
    code,
    error: "Bad Request",
    statusCode: 400,
  });
}

/**
 * Truncate a string to N UTF-8 bytes (PayTR basket lines are
 * base64-encoded and have a byte-length limit, not a char limit).
 * `.slice(N)` on a JS string counts UTF-16 code units, which
 * undercounts Turkish letters and emoji.
 */
export function truncateUtf8(input: string, maxBytes: number): string {
  if (!input) return "";
  const buf = Buffer.from(input, "utf8");
  if (buf.byteLength <= maxBytes) return input;
  // Walk back to a UTF-8-safe boundary so we don't split a multi-byte char.
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf8");
}
