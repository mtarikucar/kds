import type { ShippingAddress } from './storeApi';

/**
 * Pure formatter for a hardware-order shipping address.
 *
 * Extracted verbatim from HardwareOrderDetailPage (v2.8.84) so the
 * presentation logic is unit-testable in isolation. A free-text string
 * address is split on newlines; a structured ShippingAddress is rendered
 * line-by-line with district + city joined on the same line.
 */
export function formatAddress(raw: ShippingAddress | string): string[] {
  if (typeof raw === 'string') {
    return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  const lines: string[] = [];
  const push = (v: string | undefined) => {
    if (v && v.trim()) lines.push(v.trim());
  };
  push(raw.recipientName);
  push(raw.line1);
  push(raw.line2);
  const district = [raw.district, raw.city].filter(Boolean).join(', ');
  if (district) lines.push(district);
  push(raw.postalCode);
  push(raw.country);
  push(raw.phone);
  return lines;
}
