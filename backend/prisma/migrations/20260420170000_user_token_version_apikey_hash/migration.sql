-- User.tokenVersion: JWT payload carries `ver`; bumping this invalidates
-- every prior access token for the user. Matches the existing fields on
-- super_admins.tokenVersion and marketing_users.tokenVersion.
ALTER TABLE "users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- ApiKey.keyHash: replace plaintext `key` with SHA-256 hash. Existing rows
-- (if any) are rehashed opportunistically on first lookup; production
-- deployments should rotate any still-live keys. The plaintext is never
-- re-emitted — the admin UI surfaces the full key once on creation.
ALTER TABLE "api_keys" RENAME COLUMN "key" TO "keyHash";
DROP INDEX IF EXISTS "api_keys_key_idx";
