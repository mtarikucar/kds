-- Marketing referral code: marketers get a public-facing code they can
-- share via /?ref=CODE links. The checkout flow resolves the code at
-- intent-creation time and stamps the snapshot onto the payment so it
-- survives a later regenerate. All columns nullable so existing rows
-- backfill cleanly; the one-shot population script
-- (seed-marketers-referral-backfill.ts) moved to the standalone
-- kds-marketing project along with the marketing bounded context.

ALTER TABLE "marketing_users"
  ADD COLUMN "referralCode"          TEXT,
  ADD COLUMN "referralCodeUpdatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "marketing_users_referralCode_key"
  ON "marketing_users"("referralCode");

ALTER TABLE "subscription_payments"
  ADD COLUMN "referralCode"               TEXT,
  ADD COLUMN "referredByMarketingUserId"  TEXT;

ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_referredByMarketingUserId_fkey"
  FOREIGN KEY ("referredByMarketingUserId")
  REFERENCES "marketing_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "subscription_payments_referredByMarketingUserId_idx"
  ON "subscription_payments"("referredByMarketingUserId");
