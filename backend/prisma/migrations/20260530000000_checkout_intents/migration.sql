-- v2.8.85 — Mixed-cart checkout intents.
--
-- A CheckoutIntent row is the seam between the synchronous "create PayTR
-- token" call and the asynchronous webhook callback. The frontend posts a
-- cart, we mint a stable paymentRef (prefix "CK-"), persist the cart shape
-- + amount under that ref, and hand PayTR the iframe token. When PayTR
-- calls back hours later we look the cart up by ref and run the same
-- CheckoutService.confirmAndProvision path that admin-comp uses.
--
-- Why persist the cart server-side instead of round-tripping it through
-- the client: a malicious buyer could otherwise swap the cart between
-- get-token and webhook callback (e.g. price a single license then
-- provision a full hardware order). Server-stored cart + paymentRef makes
-- the buyer's input authoritative at one moment only — at /intent time.
--
-- Status lifecycle:
--   pending     — token issued, no PayTR callback yet
--   succeeded   — PayTR callback verified status=success, not yet provisioned
--   provisioned — CheckoutService.confirmAndProvision completed
--   failed      — PayTR callback verified status=failed (failureReason set)
--
-- paymentRef is the source of idempotency. UNIQUE so PayTR retries can't
-- double-provision; CheckoutService.confirmAndProvision ALSO checks this
-- (defence in depth).
CREATE TABLE "checkout_intents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentRef" TEXT NOT NULL,
    "cartJson" JSONB NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "providerId" TEXT NOT NULL DEFAULT 'paytr',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failureReason" TEXT,
    "hardwareOrderId" TEXT,
    "addOnIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeededAt" TIMESTAMP(3),
    "provisionedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "checkout_intents_pkey" PRIMARY KEY ("id")
);

-- Webhook lookup path — single equality on paymentRef.
CREATE UNIQUE INDEX "checkout_intents_paymentRef_key" ON "checkout_intents"("paymentRef");

-- Per-tenant audit list ("show me my unfinished checkouts" + ops dashboards).
CREATE INDEX "checkout_intents_tenantId_status_idx" ON "checkout_intents"("tenantId", "status");

-- Sweeper / retention queries.
CREATE INDEX "checkout_intents_createdAt_idx" ON "checkout_intents"("createdAt");
