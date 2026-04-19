-- Drop dead external-provider columns (Stripe / PayTR were removed in
-- prior commits; the contact-based flow is the only supported model).

ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "stripeSubscriptionId";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "stripeCustomerId";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "paytrMerchantOid";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "paytrPaymentToken";
-- Unused one-time-payment renewal-link fields (never wired up).
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "renewalLinkSentAt";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "renewalLinkToken";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "graceEndDate";

ALTER TABLE "subscription_payments" DROP COLUMN IF EXISTS "stripePaymentIntentId";
ALTER TABLE "subscription_payments" DROP COLUMN IF EXISTS "paytrMerchantOid";
ALTER TABLE "subscription_payments" DROP COLUMN IF EXISTS "paytrPaymentToken";

-- New free-form external-reference column (receipt id / bank transfer)
-- for audit trails on contact-based payments.
ALTER TABLE "subscription_payments" ADD COLUMN "externalReference" TEXT;
CREATE UNIQUE INDEX "subscription_payments_externalReference_key" ON "subscription_payments"("externalReference");

-- Invoice-number counter, updated atomically in the same transaction
-- as invoice creation to eliminate duplicate-number races.
CREATE TABLE "invoice_counters" (
    "scope" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("scope")
);

-- Prevent two ACTIVE / TRIALING subscriptions on the same tenant — the
-- TOCTOU in createSubscription would otherwise allow duplicates.
CREATE UNIQUE INDEX "subscriptions_tenantId_active_key"
    ON "subscriptions"("tenantId")
    WHERE "status" IN ('ACTIVE', 'TRIALING');
