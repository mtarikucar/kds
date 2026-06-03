-- v2.8.97 P2e — LeadOffer.discount precision bump
--
-- Was Decimal(5,2) (max 999.99 TRY) — too small for enterprise-tier
-- discount offers. Aligned with every other money column at
-- Decimal(10,2). Safe in-place ALTER: PostgreSQL widens NUMERIC
-- precision without rewriting rows.

ALTER TABLE "lead_offers"
  ALTER COLUMN "discount" TYPE DECIMAL(10, 2);
