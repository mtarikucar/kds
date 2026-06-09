import { randomBytes } from "crypto";

// Letters and digits the generator uses. We strip the easily-confused
// 0/O, 1/I/L pairs so codes read cleanly when a marketer dictates
// theirs over the phone or types one from a printed flyer.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const TR_NORMALIZATION: Record<string, string> = {
  Ç: "C",
  Ğ: "G",
  İ: "I",
  Ö: "O",
  Ş: "S",
  Ü: "U",
  ç: "C",
  ğ: "G",
  ı: "I",
  ö: "O",
  ş: "S",
  ü: "U",
};

function asciiPrefix(firstName: string): string {
  const normalised = (firstName ?? "")
    .split("")
    .map((ch) => TR_NORMALIZATION[ch] ?? ch.toUpperCase())
    .join("")
    .replace(/[^A-Z]/g, "");
  // Three letters is a reasonable "looks like a name" balance — short
  // enough to leave entropy room in 7-char codes, long enough to feel
  // personal. Fallback `MKT` when the input has no usable letters.
  if (normalised.length >= 3) return normalised.slice(0, 3);
  return "MKT";
}

function randomSuffix(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function generateReferralCode(firstName: string): string {
  return `${asciiPrefix(firstName)}${randomSuffix(4)}`;
}

// Used when prefix generation collided too many times in a row — fall
// back to a fully random, brand-prefixed code so we can always finish
// the create() transaction.
export function generateFallbackReferralCode(): string {
  return `MKT${randomSuffix(6)}`;
}

// Accept 5–12 chars from the same restricted alphabet. Used by the
// payments DTO transform so a junk `?ref=...` value can be silently
// dropped instead of failing checkout, and by the marketer-resolve
// service to short-circuit DB lookups for obviously bad inputs.
const REFERRAL_CODE_REGEX = /^[A-Z2-9]{5,12}$/;

export function isValidReferralCodeFormat(
  code: string | null | undefined,
): boolean {
  if (!code) return false;
  return REFERRAL_CODE_REGEX.test(code);
}

export function normalizeReferralCode(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  const trimmed = code.trim().toUpperCase();
  return isValidReferralCodeFormat(trimmed) ? trimmed : null;
}
