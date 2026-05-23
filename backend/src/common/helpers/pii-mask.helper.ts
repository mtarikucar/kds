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
