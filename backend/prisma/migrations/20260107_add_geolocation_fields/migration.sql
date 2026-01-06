-- Add geolocation fields to tenants table for QR menu location validation
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "locationRadius" INTEGER NOT NULL DEFAULT 100;

-- Add geolocation fields to customer_sessions table
ALTER TABLE "customer_sessions" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "customer_sessions" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
