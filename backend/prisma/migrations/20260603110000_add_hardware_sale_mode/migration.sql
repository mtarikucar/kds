-- CreateEnum
CREATE TYPE "HardwareSaleMode" AS ENUM ('DIRECT_SALE', 'QUOTE_ONLY', 'PARTNER_REDIRECT', 'RECOMMENDED_ONLY');

-- AlterTable
-- Regulatory sale tier (TR law). Additive + non-destructive: existing rows
-- default to DIRECT_SALE; a data step (seed / backfill) sets
-- yazarkasa→QUOTE_ONLY, pos_terminal→PARTNER_REDIRECT, scale→RECOMMENDED_ONLY.
ALTER TABLE "hardware_products"
  ADD COLUMN "saleMode" "HardwareSaleMode" NOT NULL DEFAULT 'DIRECT_SALE',
  ADD COLUMN "partnerRedirect" JSONB,
  ADD COLUMN "complianceDocs" JSONB;
