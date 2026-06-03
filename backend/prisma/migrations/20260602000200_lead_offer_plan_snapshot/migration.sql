-- Phase 1 / Step E marketing decoupling — LeadOffer plan snapshot.
--
-- Captured at offer-create time (via CoreProvisioningPort.describePlan) so an
-- offer stays self-contained once the plan FK is dropped (Step F) and the plan
-- eventually lives in a separate DB. planId remains the canonical soft
-- reference; these columns are display/audit data. All nullable — existing
-- offers backfill lazily (a one-shot backfill can populate open DRAFT/SENT
-- offers before Step F if desired).
ALTER TABLE "lead_offers"
  ADD COLUMN "planCode"         TEXT,
  ADD COLUMN "planName"         TEXT,
  ADD COLUMN "planMonthlyPrice" DECIMAL(10,2),
  ADD COLUMN "planCurrency"     TEXT;
