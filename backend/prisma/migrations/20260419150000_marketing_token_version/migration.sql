-- Carry a version in marketing access/refresh JWTs so logout and
-- password change can revoke outstanding sessions.
ALTER TABLE "marketing_users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
