import { test } from '../../../fixtures/test';

/**
 * Phase 4 — Recurring renewal.
 *
 * Renewals are driven by `SubscriptionSchedulerService.handleSubscriptionRenewals`
 * — a `@Cron('0 2 * * *')` job that runs at 02:00 daily and picks up
 * subscriptions whose `currentPeriodEnd` falls in the next 24h. When a
 * tenant has a stored `paytrRecurringToken`, the scheduler calls
 * `paytr.chargeRecurring(...)` directly (server-to-server) and bumps
 * the period inline — *no* webhook ever fires for renewals. When the
 * token is missing, the sub drops to PAST_DUE for manual re-checkout.
 *
 * There is no public/admin/superadmin HTTP endpoint that triggers the
 * renewal cron on demand. The only callers of `renewOneSubscription`
 * and `chargeRecurring` are the cron itself and the unit-test file at
 * backend/src/modules/subscriptions/services/subscription-scheduler.service.spec.ts.
 *
 * Posting a synthetic "renewal success" webhook to /webhooks/paytr
 * would also be a no-op for renewal accounting: the controller's
 * applySuccess() path treats every callback as either a first-time
 * subscription activation or an upgrade (via PendingPlanChange).
 * There is no "renewal" code path in the webhook because PayTR's
 * recurring API delivers its outcome as the synchronous response to
 * chargeRecurring, not as a callback.
 *
 * Net: this phase cannot be exercised through E2E without (a) exposing
 * a superadmin trigger for the scheduler, or (b) running the
 * unit-level scheduler spec. Both are out of scope here. We skip with
 * the rationale documented so the matrix stays honest.
 */
test.describe('Subscription lifecycle — recurring renewal', () => {
  test('recurring renewal is scheduler-driven; no E2E trigger surface', async () => {
    test.skip(
      true,
      [
        'SubscriptionSchedulerService.handleSubscriptionRenewals is a cron-only',
        'entrypoint with no HTTP trigger. PayTR recurring charges are',
        'server-to-server synchronous (no webhook callback), so',
        '/webhooks/paytr cannot stand in for a renewal. Covered at the',
        'unit level: backend/src/modules/subscriptions/services/',
        'subscription-scheduler.service.spec.ts.',
      ].join(' '),
    );
  });
});
