-- Rollback: yalnızca bu migration'ın eklediği iki kolonu kaldırır.
-- Idempotent: IF EXISTS ile zaten-geri-alınmış durumda güvenli no-op.
ALTER TABLE "accounting_settings" DROP COLUMN IF EXISTS "nilveraApiUrl";
ALTER TABLE "accounting_settings" DROP COLUMN IF EXISTS "nilveraApiKey";
