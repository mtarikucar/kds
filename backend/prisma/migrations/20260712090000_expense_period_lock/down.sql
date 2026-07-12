-- Rollback for 20260712090000_expense_period_lock.
-- Tam ters çevirir: yalnızca bu migration'ın eklediği tabloyu (ve onunla
-- birlikte index'ini) kaldırır. Başka hiçbir tabloya/veriye dokunmaz.
-- Idempotent: tablo zaten yoksa no-op.
DROP TABLE IF EXISTS "expense_period_locks";
