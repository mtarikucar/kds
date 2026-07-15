-- Rollback for occupancy_read_index: drops exactly the index the up added.

DROP INDEX IF EXISTS "occupancy_records_tenantId_branchId_timestamp_idx";
