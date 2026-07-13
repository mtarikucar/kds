-- Nilvera özel entegratör alanları (statik API-anahtarı modeli).
-- Idempotent: IF NOT EXISTS ile tekrar çalıştırma güvenli.
ALTER TABLE "accounting_settings" ADD COLUMN IF NOT EXISTS "nilveraApiUrl" TEXT;
ALTER TABLE "accounting_settings" ADD COLUMN IF NOT EXISTS "nilveraApiKey" TEXT;
