-- Progressive ("Dutch-style") per-item payments. Each row links a Payment to
-- a specific OrderItem and the number of units that Payment settled. Lets
-- the same order close across multiple payments and supports quantity-level
-- granularity (one customer pays for 1 of 2 cocktails on a single line).
--
-- Integrity (enforced by service layer inside the payment transaction):
--   sum(quantity) WHERE orderItemId = X AND payment.status = 'COMPLETED'
--     <= orderItem.quantity
--
-- Refund frees the units: the REFUNDED transition does deleteMany on the
-- related rows in the same tx. Payment itself stays for audit.

CREATE TABLE "order_item_payments" (
  "id"          TEXT NOT NULL,
  "paymentId"   TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "quantity"    INTEGER NOT NULL,
  "amount"      DECIMAL(10,2) NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "order_item_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_item_payments_paymentId_idx"   ON "order_item_payments"("paymentId");
CREATE INDEX "order_item_payments_orderItemId_idx" ON "order_item_payments"("orderItemId");
CREATE INDEX "order_item_payments_tenantId_idx"    ON "order_item_payments"("tenantId");
CREATE INDEX "order_item_payments_orderItemId_paymentId_idx"
  ON "order_item_payments"("orderItemId", "paymentId");

-- RESTRICT, not CASCADE: Payment rows are never hard-deleted today
-- (refund flips to REFUNDED), so cascade is dormant. If a future
-- hard-delete path is added, cascade would silently nuke the per-item
-- audit trail along with the Payment. The REFUNDED branch in
-- PaymentsService.updateStatus does an explicit deleteMany on the
-- allocations inside the same tx — that's the authorized path.
ALTER TABLE "order_item_payments"
  ADD CONSTRAINT "order_item_payments_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_item_payments"
  ADD CONSTRAINT "order_item_payments_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_item_payments"
  ADD CONSTRAINT "order_item_payments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
