-- Adds a metadata JSONB column to lead_activities so assignment events
-- can carry { kind, fromUserId, fromUserName, toUserId, toUserName,
-- bulk?, auto? } without losing structure to free-form titles.
ALTER TABLE "lead_activities" ADD COLUMN "metadata" JSONB;

-- Singleton config row for marketing-side lead auto-distribution.
-- DISABLED = manual, ROUND_ROBIN = stable cursor across active reps,
-- LEAST_LOADED = pick rep with fewest open (non-WON/LOST) leads.
CREATE TABLE "marketing_distribution_config" (
  "id" TEXT NOT NULL,
  "strategy" TEXT NOT NULL DEFAULT 'DISABLED',
  "lastAssignedToId" TEXT,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketing_distribution_config_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row so the service never has to handle the
-- "no config yet" case at runtime; it can update in place.
INSERT INTO "marketing_distribution_config" (id, strategy, "updatedAt")
VALUES (gen_random_uuid(), 'DISABLED', NOW());
