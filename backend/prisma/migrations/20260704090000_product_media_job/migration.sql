-- AI media generation jobs (fal.ai queue): PHOTO | FRAME | VIDEO.
-- Additive; existing media columns untouched.
CREATE TABLE IF NOT EXISTS "product_media_jobs" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "falRequestId" TEXT,
    "prompt" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "percent" INTEGER,
    "queuePosition" INTEGER,
    "lastLog" TEXT,
    "resultUrls" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_media_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "product_media_jobs_productId_kind_idx" ON "product_media_jobs"("productId", "kind");
CREATE INDEX IF NOT EXISTS "product_media_jobs_status_idx" ON "product_media_jobs"("status");
ALTER TABLE "product_media_jobs" ADD CONSTRAINT "product_media_jobs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
