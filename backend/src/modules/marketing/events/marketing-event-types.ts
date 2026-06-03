/**
 * Marketing-produced domain events. Versioned dotted names under the
 * `marketing.` prefix — allowlisted in outbox/event-types.ts
 * (DYNAMIC_EVENT_TYPE_PREFIXES) so the unregistered-type warning doesn't fire,
 * and dedup-required (outbox.service.ts DEDUP_REQUIRED_PREFIXES) so producers
 * must pass a deterministic idempotencyKey.
 *
 * Marketing owns these; at the Phase-5 split they move with the marketing
 * service. Payloads are intentionally minimal and self-contained.
 */
export const MarketingEventTypes = {
  LeadConverted: "marketing.lead.converted.v1",
  CommissionCredited: "marketing.commission.credited.v1",
} as const;

export type MarketingEventType =
  (typeof MarketingEventTypes)[keyof typeof MarketingEventTypes];

export interface MarketingLeadConvertedPayload {
  leadId: string;
  tenantId: string;
  /** Assigned rep, if any. null when the lead was unassigned at conversion. */
  marketingUserId: string | null;
  /** The SIGNUP commission minted on conversion, if a rep was assigned. */
  commissionId: string | null;
  occurredAt: string;
}

export interface MarketingCommissionCreditedPayload {
  commissionId: string;
  tenantId: string;
  marketingUserId: string;
  type: "SIGNUP" | "RENEWAL" | "UPSELL";
  amount: number;
  /** Accrual period, `YYYY-MM`. */
  period: string;
  occurredAt: string;
}
