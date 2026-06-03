-- Race-proof bridge claim.
--
-- Two parallel claim requests with the same provisioning token could both
-- find the row (status='claiming') and both issue bearer tokens because
-- the find-then-update window was lock-free. The simplest fix is to make
-- the token hash globally unique — Postgres rejects the second concurrent
-- update with a P2002 (unique violation), which the service maps to a
-- clear NotFoundException.
--
-- SQL-standard unique allows multiple NULLs (rows post-claim where the
-- hash is nulled), so we don't need a partial index — the default
-- semantics match exactly what we want.

CREATE UNIQUE INDEX "local_bridge_agents_provisioningTokenHash_key"
  ON "local_bridge_agents" ("provisioningTokenHash");
