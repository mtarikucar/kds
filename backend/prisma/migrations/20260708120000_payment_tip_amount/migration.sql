-- Tip recorded alongside a payment (cash declared / card tip). Informational —
-- not part of the goods-total reconciliation; drives the tips report + payroll.
ALTER TABLE "payments" ADD COLUMN "tipAmount" DECIMAL(10,2);
