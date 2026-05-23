/**
 * PII masking for log output.
 *
 * iter-15 stripped emails from Sentry events via beforeSend, but several
 * call sites still interpolated full email addresses into Logger.log /
 * Logger.error messages. Those land in the structured-JSON log stream
 * (Loki / Datadog) which is long-term retained — exactly the same KVKK /
 * GDPR concern the Sentry scrub was supposed to close.
 *
 * The contract: keep enough of the address for debugging (first char of
 * local part, full domain) but redact the rest. A support engineer can
 * still tell two addresses apart in adjacent log lines without seeing the
 * full PII.
 *
 *   "alice@example.com"   → "a***@example.com"
 *   "bob.smith@host.com"  → "b***@host.com"
 *   "x@host.com"          → "*@host.com"     (single-char local — fully masked)
 *   "no-at-sign"          → "***"            (not an email — fully masked)
 *   ""                    → ""
 */
export function maskEmail(value: string | null | undefined): string {
  if (!value) return '';
  const at = value.indexOf('@');
  if (at <= 0) return '***';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length === 1) return `*@${domain}`;
  return `${local[0]}***@${domain}`;
}

/**
 * Mask a phone number for log output. Keeps country-code prefix + last 2
 * digits so support can match a customer report to a log entry without
 * exposing the full number to anyone with log access.
 *
 *   "+905551112233"  → "+90****33"
 *   "+15551112233"   → "+1****33"
 *   "5551112233"     → "***33"          (no leading + → no country code kept)
 *   "abc"            → "***"            (too short → fully masked)
 *   ""               → ""
 */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return '';
  // Strip whitespace for length checks; preserve only digits + optional +.
  const trimmed = value.trim();
  if (trimmed.length < 4) return '***';
  if (trimmed.startsWith('+')) {
    // Country code = + plus 1-3 digits up to the first non-digit OR after 3 digits.
    // Cheap rule: keep + + the first 1-2 digits and the last 2.
    const cc = trimmed.startsWith('+9') ? trimmed.slice(0, 3) : trimmed.slice(0, 2);
    const tail = trimmed.slice(-2);
    return `${cc}****${tail}`;
  }
  return `***${trimmed.slice(-2)}`;
}
