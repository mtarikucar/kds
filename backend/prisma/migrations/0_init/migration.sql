-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "marketing_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "avatar" TEXT,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastLogin" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "referralCode" TEXT,
    "referralCodeUpdatedAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "region" TEXT,
    "businessType" TEXT NOT NULL,
    "tableCount" INTEGER,
    "branchCount" INTEGER,
    "currentSystem" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "lostReason" TEXT,
    "notes" TEXT,
    "nextFollowUp" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "externalRef" TEXT,
    "assignedToId" TEXT,
    "convertedTenantId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "outcome" TEXT,
    "duration" INTEGER,
    "metadata" JSONB,
    "leadId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "leadId" TEXT,
    "assignedToId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_offers" (
    "id" TEXT NOT NULL,
    "planId" TEXT,
    "planCode" TEXT,
    "planName" TEXT,
    "planMonthlyPrice" DECIMAL(10,2),
    "planCurrency" TEXT,
    "customPrice" DECIMAL(10,2),
    "discount" DECIMAL(10,2),
    "trialDays" INTEGER,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "validUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "leadId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "period" TEXT NOT NULL,
    "tenantId" TEXT,
    "leadId" TEXT,
    "notes" TEXT,
    "marketingUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "auditLog" JSONB,
    "sourcePaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_notifications" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_distribution_config" (
    "id" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'DISABLED',
    "lastAssignedToId" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_distribution_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_calls" (
    "id" TEXT NOT NULL,
    "marketingUserId" TEXT NOT NULL,
    "leadId" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
    "toPhone" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "externalCallId" TEXT,
    "durationSec" INTEGER,
    "recordingUrl" TEXT,
    "notes" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installation_crews" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "dailyCapacity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installation_crews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installation_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT,
    "crewId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "scheduledDate" DATE,
    "scheduledWindow" TEXT,
    "siteAddress" TEXT,
    "siteCity" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installation_tasks" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_targets" (
    "id" TEXT NOT NULL,
    "marketingUserId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "targetValue" DECIMAL(14,2) NOT NULL,
    "setById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tenantId" TEXT,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketing_users_email_key" ON "marketing_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_users_referralCode_key" ON "marketing_users"("referralCode");

-- CreateIndex
CREATE INDEX "marketing_users_email_idx" ON "marketing_users"("email");

-- CreateIndex
CREATE INDEX "marketing_users_role_idx" ON "marketing_users"("role");

-- CreateIndex
CREATE INDEX "marketing_users_status_idx" ON "marketing_users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "leads_externalRef_key" ON "leads"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "leads_convertedTenantId_key" ON "leads"("convertedTenantId");

-- CreateIndex
CREATE INDEX "leads_assignedToId_idx" ON "leads"("assignedToId");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_city_idx" ON "leads"("city");

-- CreateIndex
CREATE INDEX "leads_source_idx" ON "leads"("source");

-- CreateIndex
CREATE INDEX "leads_businessType_idx" ON "leads"("businessType");

-- CreateIndex
CREATE INDEX "leads_createdAt_idx" ON "leads"("createdAt");

-- CreateIndex
CREATE INDEX "leads_nextFollowUp_idx" ON "leads"("nextFollowUp");

-- CreateIndex
CREATE INDEX "leads_priority_idx" ON "leads"("priority");

-- CreateIndex
CREATE INDEX "leads_assignedToId_status_idx" ON "leads"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "leads_status_createdAt_idx" ON "leads"("status", "createdAt");

-- CreateIndex
CREATE INDEX "lead_activities_leadId_idx" ON "lead_activities"("leadId");

-- CreateIndex
CREATE INDEX "lead_activities_createdById_idx" ON "lead_activities"("createdById");

-- CreateIndex
CREATE INDEX "lead_activities_createdAt_idx" ON "lead_activities"("createdAt");

-- CreateIndex
CREATE INDEX "lead_activities_type_idx" ON "lead_activities"("type");

-- CreateIndex
CREATE INDEX "marketing_tasks_assignedToId_idx" ON "marketing_tasks"("assignedToId");

-- CreateIndex
CREATE INDEX "marketing_tasks_leadId_idx" ON "marketing_tasks"("leadId");

-- CreateIndex
CREATE INDEX "marketing_tasks_dueDate_idx" ON "marketing_tasks"("dueDate");

-- CreateIndex
CREATE INDEX "marketing_tasks_status_idx" ON "marketing_tasks"("status");

-- CreateIndex
CREATE INDEX "marketing_tasks_assignedToId_status_idx" ON "marketing_tasks"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "marketing_tasks_dueDate_status_idx" ON "marketing_tasks"("dueDate", "status");

-- CreateIndex
CREATE INDEX "lead_offers_leadId_idx" ON "lead_offers"("leadId");

-- CreateIndex
CREATE INDEX "lead_offers_createdById_idx" ON "lead_offers"("createdById");

-- CreateIndex
CREATE INDEX "lead_offers_status_idx" ON "lead_offers"("status");

-- CreateIndex
CREATE INDEX "lead_offers_leadId_status_idx" ON "lead_offers"("leadId", "status");

-- CreateIndex
CREATE INDEX "commissions_marketingUserId_idx" ON "commissions"("marketingUserId");

-- CreateIndex
CREATE INDEX "commissions_tenantId_idx" ON "commissions"("tenantId");

-- CreateIndex
CREATE INDEX "commissions_leadId_idx" ON "commissions"("leadId");

-- CreateIndex
CREATE INDEX "commissions_period_idx" ON "commissions"("period");

-- CreateIndex
CREATE INDEX "commissions_status_idx" ON "commissions"("status");

-- CreateIndex
CREATE INDEX "commissions_period_status_idx" ON "commissions"("period", "status");

-- CreateIndex
CREATE INDEX "commissions_sourcePaymentId_idx" ON "commissions"("sourcePaymentId");

-- CreateIndex
CREATE INDEX "marketing_notifications_userId_isRead_idx" ON "marketing_notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "marketing_notifications_createdAt_idx" ON "marketing_notifications"("createdAt");

-- CreateIndex
CREATE INDEX "sales_calls_marketingUserId_startedAt_idx" ON "sales_calls"("marketingUserId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "sales_calls_leadId_idx" ON "sales_calls"("leadId");

-- CreateIndex
CREATE INDEX "sales_calls_status_idx" ON "sales_calls"("status");

-- CreateIndex
CREATE INDEX "installation_crews_active_idx" ON "installation_crews"("active");

-- CreateIndex
CREATE INDEX "installation_jobs_status_idx" ON "installation_jobs"("status");

-- CreateIndex
CREATE INDEX "installation_jobs_crewId_scheduledDate_idx" ON "installation_jobs"("crewId", "scheduledDate");

-- CreateIndex
CREATE INDEX "installation_jobs_tenantId_idx" ON "installation_jobs"("tenantId");

-- CreateIndex
CREATE INDEX "installation_jobs_scheduledDate_idx" ON "installation_jobs"("scheduledDate");

-- CreateIndex
CREATE INDEX "installation_tasks_jobId_idx" ON "installation_tasks"("jobId");

-- CreateIndex
CREATE INDEX "sales_targets_period_idx" ON "sales_targets"("period");

-- CreateIndex
CREATE INDEX "sales_targets_marketingUserId_period_idx" ON "sales_targets"("marketingUserId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "sales_targets_marketingUserId_period_metric_key" ON "sales_targets"("marketingUserId", "period", "metric");

-- CreateIndex
CREATE INDEX "outbox_events_status_nextAttemptAt_idx" ON "outbox_events"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "outbox_events_type_createdAt_idx" ON "outbox_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "outbox_events_tenantId_createdAt_idx" ON "outbox_events"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "marketing_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "marketing_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_tasks" ADD CONSTRAINT "marketing_tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_tasks" ADD CONSTRAINT "marketing_tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "marketing_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_offers" ADD CONSTRAINT "lead_offers_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_offers" ADD CONSTRAINT "lead_offers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "marketing_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_marketingUserId_fkey" FOREIGN KEY ("marketingUserId") REFERENCES "marketing_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_notifications" ADD CONSTRAINT "marketing_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "marketing_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installation_tasks" ADD CONSTRAINT "installation_tasks_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "installation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Raw-SQL invariants Prisma cannot express ────────────────────────────────
-- Exactly-once RENEWAL/UPSELL commission per (payment, type) under
-- at-least-once event delivery (SettlementCommissionConsumer). Partial so
-- legacy rows (sourcePaymentId NULL) and SIGNUP's own dedupe path are
-- unaffected. Carried over from the monorepo migration
-- 20260602000100_commission_source_payment.
CREATE UNIQUE INDEX "commissions_sourcePaymentId_type_key"
  ON "commissions"("sourcePaymentId", "type")
  WHERE "sourcePaymentId" IS NOT NULL;
