-- v2.8.98 P3a — partial unique index for one-active-request-per-session
--
-- WaiterRequest and BillRequest both model "the customer at this table
-- is asking for service / their bill". Multiple PENDING rows for the
-- same (sessionId, tenantId) pair just spam the kitchen feed; only the
-- first should land, and a customer double-tapping the button should
-- see the existing one.
--
-- Expressed as a partial unique index (Prisma can't model partial
-- uniques in the schema DSL, so we add them in migration SQL). The
-- index ignores ACKNOWLEDGED / COMPLETED rows so a new request after
-- the previous one was resolved still lands.

CREATE UNIQUE INDEX IF NOT EXISTS "waiter_requests_session_active_uniq"
  ON "waiter_requests" ("sessionId", "tenantId")
  WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS "bill_requests_session_active_uniq"
  ON "bill_requests" ("sessionId", "tenantId")
  WHERE "status" = 'PENDING';
