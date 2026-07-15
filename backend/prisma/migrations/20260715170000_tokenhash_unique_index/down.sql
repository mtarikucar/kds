-- Rollback for tokenhash_unique_index: drops exactly the two indexes the up
-- added. Safe no-op when already reverted.

DROP INDEX IF EXISTS "devices_tokenHash_key";
DROP INDEX IF EXISTS "local_bridge_agents_tokenHash_key";
