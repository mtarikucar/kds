-- Fiscal finalization columns on ZReport. Previously closeReport reused the
-- pdfExported flag as an informal "finalized" marker, which was racy and
-- didn't freeze any numbers. The isFinalized boolean is the new authoritative
-- guard; payloadHash stores a SHA-256 fingerprint of the canonical fiscal
-- payload at finalization time so tampering is detectable on audit.
ALTER TABLE "z_reports" ADD COLUMN "isFinalized" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "z_reports" ADD COLUMN "finalizedAt" TIMESTAMP(3);
ALTER TABLE "z_reports" ADD COLUMN "finalizedById" TEXT;
ALTER TABLE "z_reports" ADD COLUMN "payloadHash" TEXT;
