-- Phase 3 installation ops (inside the marketing context). Crews + jobs + task
-- checklists. tenantId is a soft (no-FK) reference to the core tenant;
-- leadId/crewId are soft references to marketing-owned tables. Only the
-- job→task relation is a real FK (cascade delete tasks with the job).
CREATE TABLE "installation_crews" (
  "id"            TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "dailyCapacity" INTEGER NOT NULL DEFAULT 1,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "installation_crews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "installation_crews_active_idx" ON "installation_crews"("active");

CREATE TABLE "installation_jobs" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "leadId"          TEXT,
  "crewId"          TEXT,
  "status"          TEXT NOT NULL DEFAULT 'REQUESTED',
  "scheduledDate"   DATE,
  "scheduledWindow" TEXT,
  "siteAddress"     TEXT,
  "siteCity"        TEXT,
  "contactName"     TEXT,
  "contactPhone"    TEXT,
  "notes"           TEXT,
  "requestedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduledAt"     TIMESTAMP(3),
  "startedAt"       TIMESTAMP(3),
  "completedAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "installation_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "installation_jobs_status_idx" ON "installation_jobs"("status");
CREATE INDEX "installation_jobs_crewId_scheduledDate_idx" ON "installation_jobs"("crewId", "scheduledDate");
CREATE INDEX "installation_jobs_tenantId_idx" ON "installation_jobs"("tenantId");
CREATE INDEX "installation_jobs_scheduledDate_idx" ON "installation_jobs"("scheduledDate");

CREATE TABLE "installation_tasks" (
  "id"        TEXT NOT NULL,
  "jobId"     TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "done"      BOOLEAN NOT NULL DEFAULT false,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "installation_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "installation_tasks_jobId_idx" ON "installation_tasks"("jobId");
ALTER TABLE "installation_tasks"
  ADD CONSTRAINT "installation_tasks_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "installation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
