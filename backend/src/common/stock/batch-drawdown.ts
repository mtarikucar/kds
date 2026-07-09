import { Prisma } from "@prisma/client";

/**
 * FIFO draw-down of a stock item's StockBatch cost sub-ledger. Every physical
 * stock-OUT path (order deduction, waste, supplier return, transfer-out) must
 * call this so Σ(batch.quantity) stays in sync with the authoritative
 * StockItem.currentStock — otherwise the batch-valuation report and FIFO-COGS
 * drift (a returned/transferred unit keeps a phantom cost layer). Oldest expiry
 * then oldest received first. Returns how much was actually drawn from batches
 * and the weighted cost of those units (callers that lack batches fall back to
 * StockItem.costPerUnit). Safe to call inside the caller's transaction.
 */
export async function drawDownBatchesFifo(
  tx: Prisma.TransactionClient,
  scope: { stockItemId: string; tenantId: string; branchId: string },
  qty: Prisma.Decimal,
): Promise<{ consumed: Prisma.Decimal; weightedCost: Prisma.Decimal }> {
  let remaining = qty;
  const batches = await tx.stockBatch.findMany({
    where: {
      stockItemId: scope.stockItemId,
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      quantity: { gt: 0 },
    },
    orderBy: [
      { expiryDate: { sort: "asc", nulls: "last" } },
      { receivedAt: "asc" },
    ],
  });
  let consumed = new Prisma.Decimal(0);
  let weightedCost = new Prisma.Decimal(0);
  for (const batch of batches) {
    if (remaining.lte(0)) break;
    const take = Prisma.Decimal.min(remaining, batch.quantity);
    const updated = await tx.stockBatch.updateMany({
      where: { id: batch.id, quantity: { gte: take as any } },
      data: { quantity: { decrement: take as any } },
    });
    if (updated.count === 0) continue; // lost a race for this batch; try the next
    remaining = remaining.sub(take);
    consumed = consumed.add(take);
    if (batch.costPerUnit != null) {
      weightedCost = weightedCost.add(
        new Prisma.Decimal(batch.costPerUnit).mul(take),
      );
    }
  }
  return { consumed, weightedCost };
}
