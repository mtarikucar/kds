-- Replay-protection lookup index for inbound webhooks.
--
-- IntegrationService.ingestWebhook now refuses to process a body whose
-- (tenantId, providerId, signature) tuple already exists within the last
-- 24h. Without a focused index that lookup degrades to an index range
-- scan on (providerId, receivedAt) with a post-filter on signature —
-- fine at low volume, but with thousands of webhook events per provider
-- per day it starts to dominate the hot ingest path.
--
-- The three-column composite is selective enough that it acts as a
-- near-direct hit for the dedup query. `receivedAt` is filtered after
-- the index hit; for replay windows < 24h that filter is cheap.
--
-- IF NOT EXISTS keeps the apply step idempotent so the db-baseline
-- workflow can re-run safely against environments that already have it.

CREATE INDEX IF NOT EXISTS "integration_webhook_events_tenant_provider_sig_idx"
  ON "integration_webhook_events" ("tenantId", "providerId", "signature");
