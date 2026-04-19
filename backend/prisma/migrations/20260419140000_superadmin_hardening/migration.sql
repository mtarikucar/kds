-- Harden SuperAdmin model:
--   - pendingTwoFactorSecret:  staging secret until the first TOTP
--     confirms it (so a fresh setup can't lock out an already-enrolled
--     account)
--   - backupCodes:             hashed one-time recovery codes
--   - lastTotpStep / lastTotpStepExpiresAt: replay protection for TOTP
--     (a given code step can only be accepted once)
--   - tokenVersion:            carried in access tokens and bumped on
--     logout/password-change/2FA-change to revoke all outstanding JWTs
ALTER TABLE "super_admins" ADD COLUMN "pendingTwoFactorSecret" TEXT;
ALTER TABLE "super_admins" ADD COLUMN "backupCodes" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "super_admins" ADD COLUMN "lastTotpStep" BIGINT;
ALTER TABLE "super_admins" ADD COLUMN "lastTotpStepExpiresAt" TIMESTAMP(3);
ALTER TABLE "super_admins" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
