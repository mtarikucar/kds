// Versioned domain-event names. Centralising them here prevents typos at the
// emit / subscribe boundary and gives us one place to track schema versions.
// New events are added as `.v1`; non-backwards-compatible payload changes
// MUST bump the version (e.g. `.v2`) so consumers can stay on the old shape
// until they migrate. Producers MAY emit multiple versions in parallel during
// a migration; the worker delivers each verbatim.

export const EventTypes = {
  // Subscription lifecycle — projector listens for these to refresh entitlements.
  SubscriptionActivated: 'subscription.activated.v1',
  SubscriptionUpgraded: 'subscription.upgraded.v1',
  SubscriptionDowngraded: 'subscription.downgraded.v1',
  SubscriptionCancelled: 'subscription.cancelled.v1',
  SubscriptionPaymentFailed: 'subscription.payment_failed.v1',
  // Operational overrides set by super-admin.
  TenantOverridesChanged: 'tenant.overrides_changed.v1',
  // Add-on lifecycle (Phase 2; producers come later, but the constant lands
  // now so the projector subscriber doesn't need editing later).
  AddOnPurchased: 'addon.purchased.v1',
  AddOnCancelled: 'addon.cancelled.v1',
  // Entitlement-side fact: emitted by the projector AFTER it writes new rows.
  // Consumers (UI presence channel, audit) listen to know when to refresh.
  FeatureEntitlementChanged: 'feature.entitlement.changed.v1',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

// Minimal payload contracts — Zod schemas land in packages/event-contracts
// when the monorepo split happens. Until then, this is the single source of
// truth for producer/consumer agreement.

export interface SubscriptionLifecyclePayload {
  tenantId: string;
  subscriptionId: string;
  planCode?: string; // PRO, BUSINESS, ...
  periodStart?: string;
  periodEnd?: string;
}

export interface TenantOverridesChangedPayload {
  tenantId: string;
  // Just a signal that overrides changed — the projector re-reads from DB to
  // pick up the new state, so the event itself doesn't need to carry the
  // whole payload. Keeps the contract tiny and avoids stale data races.
}

export interface AddOnLifecyclePayload {
  tenantId: string;
  addOnId: string;
  addOnCode: string;
  branchId?: string | null;
}
