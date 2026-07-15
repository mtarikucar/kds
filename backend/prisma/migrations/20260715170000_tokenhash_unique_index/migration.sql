-- Unique index on the rotating bearer-token hashes. Every device/bridge auth
-- is a lookup by tokenHash; without an index it was a sequential scan per
-- request, and nothing enforced one-token-one-row. sha256 values cannot
-- realistically collide; Postgres treats NULLs as distinct, so the many
-- unprovisioned rows (tokenHash NULL) are unaffected. Idempotent; reversible.

CREATE UNIQUE INDEX IF NOT EXISTS "devices_tokenHash_key"
  ON "devices"("tokenHash");

CREATE UNIQUE INDEX IF NOT EXISTS "local_bridge_agents_tokenHash_key"
  ON "local_bridge_agents"("tokenHash");
