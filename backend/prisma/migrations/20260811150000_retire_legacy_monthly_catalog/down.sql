-- Rollback: put the eight legacy monthly rows back on sale.
--
-- Same codes, same billing guard, opposite status. It touches nothing else —
-- no ownership rows, no new catalog rows, no tenant data — and is a no-op when
-- run twice, because the second pass finds nothing still archived.
--
-- One asymmetry, stated rather than papered over: nothing marks WHICH rows the
-- up archived, so if an operator archives one of these eight between the up and
-- the down, this publishes it again along with the rest. All eight were
-- verified `published` in production before the up ran, so the rollback is
-- exact for the state it was written against.
UPDATE "marketplace_addons"
   SET "status" = 'published', "updatedAt" = NOW()
 WHERE "status" = 'archived'
   AND "billing" = 'MONTHLY'
   AND "code" IN (
     'custom_branding',
     'delivery_integration',
     'integration_efatura',
     'integration_sms',
     'inventory_tracking',
     'multi_branch',
     'personnel_management',
     'reservation_system'
   );
