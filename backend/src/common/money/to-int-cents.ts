/**
 * Convert any of {number, Prisma.Decimal, string} → integer cents.
 *
 * Why this exists: Prisma.Decimal columns deserialise to Decimal objects
 * whose `*100 → Math.round` path goes through IEEE-754, dropping precision
 * for large amounts and quietly losing the kuruş on edge values. The
 * Decimal API exposes `.toFixed(2)` which renders the canonical 2-dp
 * string; we then strip the decimal point and parse, never crossing the
 * float boundary.
 *
 * SSOT: this is the single canonical implementation shared by the order
 * outbox emit paths (OrdersService.emitOrderEvent, KdsService.emitOrderEvent,
 * CustomerOrdersService.emitOrderCreated). It is lifted VERBATIM from the
 * pre-existing OrdersService/KdsService private helper so those two call
 * sites keep byte-identical rounding; the customer-orders path fed the same
 * Prisma.Decimal `finalAmount`, for which this and its prior one-liner
 * produce the identical result.
 */
export function toIntCents(v: unknown): number | undefined {
  if (v == null) return undefined;
  // Decimal has a toFixed; number doesn't. Detect by feature instead of
  // by `instanceof Decimal` so the helper works in test fixtures that
  // pass plain numbers.
  const asDecimal = v as { toFixed?: (n: number) => string };
  if (typeof asDecimal.toFixed === "function" && typeof v !== "number") {
    const fixed = asDecimal.toFixed!(2); // "123.45"
    const cents = Number(fixed.replace(".", "")); // 12345
    return Number.isFinite(cents) ? cents : undefined;
  }
  if (typeof v === "number") return Math.round(v * 100);
  if (typeof v === "string") {
    const cents = Math.round(parseFloat(v) * 100);
    return Number.isFinite(cents) ? cents : undefined;
  }
  return undefined;
}
