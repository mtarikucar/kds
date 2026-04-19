-- Rename auth token columns to reflect that they store sha256 hashes, not plaintext

-- Email verification: rename + widen (was VARCHAR(6), now TEXT to fit sha256 hex)
ALTER TABLE "users" RENAME COLUMN "emailVerificationCode" TO "emailVerificationCodeHash";
ALTER TABLE "users" ALTER COLUMN "emailVerificationCodeHash" TYPE TEXT;

-- Password reset token rename
ALTER TABLE "users" RENAME COLUMN "resetToken" TO "resetTokenHash";

-- Rename unique constraint/index to match new column name
ALTER INDEX "users_resetToken_key" RENAME TO "users_resetTokenHash_key";
