import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";

/**
 * Atomic invoice numbering, shared by BOTH invoice worlds:
 *   - the legacy subscription `Invoice` (BillingService), and
 *   - the à-la-carte `TenantInvoice` (TenantInvoiceService, v3.3.0).
 *
 * Sharing is not a convenience — it is a correctness requirement. Both tables
 * carry a UNIQUE `invoiceNumber` over the same `INV-{YYYYMM}-{seq}-{hex}`
 * format. Two independent counters would eventually mint the same number, and
 * the resulting P2002 surfaces inside settlement — i.e. AFTER the card has
 * been charged, with the payment recorded and the invoice missing.
 *
 * The upsert must run inside the caller's transaction so the sequence is
 * serialized per YYYYMM scope: two concurrent invoice writes can then never
 * read the same counter value. The 6-hex suffix additionally defeats naive
 * enumeration of "INV-202608-0001".
 */

/** Anything that can run an `invoiceCounter.upsert` — a client or a tx. */
export type InvoiceCounterClient = {
  invoiceCounter: Prisma.InvoiceCounterDelegate<any>;
};

/** `YYYYMM` bucket the counter is scoped to. */
export function invoiceScopeFor(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}

export async function generateInvoiceNumber(
  tx: InvoiceCounterClient,
  now: Date = new Date(),
): Promise<string> {
  const scope = invoiceScopeFor(now);

  const counter = await tx.invoiceCounter.upsert({
    where: { scope },
    create: { scope, sequence: 1 },
    update: { sequence: { increment: 1 } },
  });

  const sequence = String(counter.sequence).padStart(4, "0");
  const suffix = randomBytes(3).toString("hex"); // 6 hex chars
  return `INV-${scope}-${sequence}-${suffix}`;
}
