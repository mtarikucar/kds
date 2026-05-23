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

/**
 * Mask an IP address for log output. KVKK / GDPR treat IPs as personal
 * data when paired with timestamps + identifiers.
 *
 * The masking rule keeps roughly /16 worth of structure — enough to
 * group requests from the same ISP block when debugging a flood / rate
 * issue, but not enough to track an individual user.
 *
 *   "203.0.113.42"        → "203.0.x.x"          (IPv4 → /16 retained)
 *   "2001:db8::1"         → "2001:db8:x:x:x:x:x:x" (IPv6 → /32 retained)
 *   "::1"                 → "::1"                (loopback — left as-is)
 *   "127.0.0.1"           → "127.0.0.1"          (loopback — left as-is)
 *   "unknown"             → "unknown"            (no dots/colons → returned verbatim)
 *   ""                    → ""
 *
 * SECURITY EXCEPTION: when logging an attacker's IP (e.g. webhook from
 * a non-allowlisted source, repeated auth failure from a single host),
 * keep the full IP — it's evidence in an investigation, not PII about
 * a customer. Use the raw value at those callsites and document why.
 */
export function maskIp(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  // Loopback addresses aren't PII; keep them verbatim for local-dev clarity.
  if (trimmed === '127.0.0.1' || trimmed === '::1') return trimmed;
  if (trimmed.includes(':')) {
    // IPv6 — keep the first two hextets (≈ /32, ISP-block grain).
    const parts = trimmed.split(':');
    if (parts.length < 3) return trimmed; // Malformed; return as-is.
    return `${parts[0]}:${parts[1]}:${'x:'.repeat(parts.length - 2).slice(0, -1)}`;
  }
  if (trimmed.includes('.')) {
    const octets = trimmed.split('.');
    if (octets.length !== 4) return trimmed; // Not a normal IPv4.
    return `${octets[0]}.${octets[1]}.x.x`;
  }
  return trimmed;
}
