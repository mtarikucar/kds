-- Phase 2 telephony — sales-call log over the single company Netgsm line.
-- Click-to-dial + manual outcome logging. marketingUserId/leadId are soft
-- references to marketing-owned tables (no FK — keeps the model portable for
-- the eventual DB split). externalCallId/durationSec/recordingUrl are the seams
-- a future Netgsm API/webhook provider fills.
CREATE TABLE "sales_calls" (
  "id"              TEXT NOT NULL,
  "marketingUserId" TEXT NOT NULL,
  "leadId"          TEXT,
  "direction"       TEXT NOT NULL DEFAULT 'OUTBOUND',
  "toPhone"         TEXT NOT NULL,
  "providerId"      TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'INITIATED',
  "externalCallId"  TEXT,
  "durationSec"     INTEGER,
  "recordingUrl"    TEXT,
  "notes"           TEXT,
  "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"         TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sales_calls_marketingUserId_startedAt_idx" ON "sales_calls"("marketingUserId", "startedAt" DESC);
CREATE INDEX "sales_calls_leadId_idx" ON "sales_calls"("leadId");
CREATE INDEX "sales_calls_status_idx" ON "sales_calls"("status");
