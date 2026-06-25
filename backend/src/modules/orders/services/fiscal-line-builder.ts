import { Prisma } from "@prisma/client";

/**
 * Pure GMP-3 fiscal-line arithmetic, shared by the standalone yazarkasa fiş
 * issuance (PaymentFinalizerService.maybeIssueYazarkasaReceipt) and the
 * fiscal-coupled card terminal (Gmp3CardTerminalProvider), so an atomic
 * charge+fiş prints EXACTLY the same lines/KDV the standalone path would.
 *
 * Money is integer kuruş (yazarkasa firmware is integer-only). No DB, no I/O —
 * fully unit-tested.
 */

type Numeric = number | string | Prisma.Decimal;

export interface FiscalLineItem {
  productId: string;
  productName?: string | null;
  quantity: number;
  /** Base per-unit price (excludes modifiers). */
  unitPrice: Numeric;
  /** Per-unit modifier cost (paid options). */
  modifierTotal: Numeric;
  taxRate?: number | null;
}

export interface BuiltFiscalLine {
  productCode: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  vatRate: number;
  discountCents: number;
}

/**
 * Apportion an order-level discount (kuruş) across line values using the
 * largest-remainder method. Guarantees `sum(result) === min(discount, total)`
 * exactly so the per-line discountCents never drift off the order discount on
 * a legally-binding fiş. Returns all-zero when there is no discount or no
 * value to split against.
 */
export function apportionDiscount(
  lineValuesCents: number[],
  discountCents: number,
): number[] {
  const total = lineValuesCents.reduce((a, b) => a + b, 0);
  if (discountCents <= 0 || total <= 0) {
    return lineValuesCents.map(() => 0);
  }
  // Never apportion more than the goods are worth.
  const toSplit = Math.min(discountCents, total);
  const raw = lineValuesCents.map((v) => (toSplit * v) / total);
  const result = raw.map((r) => Math.floor(r));
  let leftover = toSplit - result.reduce((a, b) => a + b, 0);
  // Hand the leftover kuruş to the largest fractional parts first.
  const byFrac = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; leftover > 0 && byFrac.length > 0; k++, leftover--) {
    result[byFrac[k % byFrac.length].i] += 1;
  }
  return result;
}

/**
 * Build GMP-3 fiscal lines from paid order items. The line value MUST include
 * paid modifiers — OrderItem stores the base price in `unitPrice` and the
 * per-unit modifier cost in `modifierTotal` separately, with
 * `subtotal = qty*(unitPrice+modifierTotal)`. Building from unitPrice alone
 * understates the goods total + KDV (and makes the tender never reconcile).
 *
 * Returns the lines plus `netCents` — the fiş goods total after the apportioned
 * discount, which equals `order.finalAmount` in kuruş by construction.
 */
export function buildFiscalLines(
  items: FiscalLineItem[],
  orderDiscount: Numeric,
): { lines: BuiltFiscalLine[]; netCents: number } {
  const effUnitCents = items.map((it) =>
    Math.round((Number(it.unitPrice) + Number(it.modifierTotal)) * 100),
  );
  const lineValuesCents = items.map((it, i) => it.quantity * effUnitCents[i]);
  const orderDiscountCents = Math.round(Number(orderDiscount) * 100);
  const perLineDiscount = apportionDiscount(
    lineValuesCents,
    orderDiscountCents,
  );

  const lines = items.map((it, i) => ({
    productCode: it.productId,
    name: it.productName ?? "Ürün",
    qty: it.quantity,
    unitPriceCents: effUnitCents[i],
    vatRate: it.taxRate ?? 10,
    discountCents: perLineDiscount[i],
  }));

  const netCents = lineValuesCents.reduce(
    (acc, v, i) => acc + v - perLineDiscount[i],
    0,
  );

  return { lines, netCents };
}
