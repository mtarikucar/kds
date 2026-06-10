import type {
  PlanSnapshot,
  ProvisionTenantForLeadCommand,
  ProvisionTenantForLeadResult,
  ProvisionedLeadRecord,
} from "./tenant-provisioning.types";

/**
 * HTTP wire contract for {@link CoreProvisioningPort} after the Phase-5
 * physical split (marketing → core direction). Vendored shared-kernel file:
 * the copies under `backend/src/core-contracts/` and
 * `kds-marketing/backend/src/core-contracts/` MUST stay byte-identical.
 *
 * Transport conventions (canonical — both sides import, never inline):
 *   - ALL routes are POST with JSON bodies. POST-for-reads is deliberate:
 *     date ranges and plan ids travel in a typed body instead of query
 *     strings / path params, and every endpoint responds 200 with a JSON
 *     envelope — never an empty body, never a semantic 404 (a 404 from
 *     these routes always means "wrong URL", not "no result").
 *   - Routes are RELATIVE (no global `api` prefix). Clients compose
 *     `${baseUrl}/api/${ROUTE}`; the Nest controller splits BASE + SEGMENTS.
 *   - Auth: INTERNAL_TOKEN_HEADER (see ../internal-http.contract).
 */
export const INTERNAL_PROVISIONING_BASE = "internal/provisioning";

/** Per-method path segments, one per CoreProvisioningPort method. */
export const INTERNAL_PROVISIONING_SEGMENTS = {
  provisionTenantForLead: "provision-tenant-for-lead",
  listProvisionedLeads: "list-provisioned-leads",
  describePlan: "describe-plan",
} as const;

/** Full relative routes (BASE/SEGMENT) for client URL composition. */
export const INTERNAL_PROVISIONING_ROUTES = {
  provisionTenantForLead: `${INTERNAL_PROVISIONING_BASE}/${INTERNAL_PROVISIONING_SEGMENTS.provisionTenantForLead}`,
  listProvisionedLeads: `${INTERNAL_PROVISIONING_BASE}/${INTERNAL_PROVISIONING_SEGMENTS.listProvisionedLeads}`,
  describePlan: `${INTERNAL_PROVISIONING_BASE}/${INTERNAL_PROVISIONING_SEGMENTS.describePlan}`,
} as const;

/** POST provision-tenant-for-lead — body is the port command verbatim. */
export type ProvisionTenantForLeadRequest = ProvisionTenantForLeadCommand;

/** 200 response — the port result verbatim. */
export type ProvisionTenantForLeadResponse = ProvisionTenantForLeadResult;

/** POST list-provisioned-leads — ISO-8601 datetime strings, both required. */
export interface ListProvisionedLeadsRequest {
  createdAfter: string;
  createdBefore: string;
}

/** 200 response — ledger entries wrapped so the envelope can grow (paging). */
export interface ListProvisionedLeadsResponse {
  leads: ProvisionedLeadRecord[];
}

/** POST describe-plan. */
export interface DescribePlanRequest {
  planId: string;
}

/**
 * 200 response — ALWAYS this envelope, `plan: null` for an unknown plan.
 * Wrapping (instead of a bare nullable body or a 404) keeps "unknown plan"
 * distinguishable from an empty body and from a mis-routed URL.
 */
export interface DescribePlanResponse {
  plan: PlanSnapshot | null;
}

/**
 * Error contract: non-2xx responses carry this structured JSON body. The
 * `code` field — NOT the HTTP status — is what clients map back onto the
 * port-local CoreProvisioning* error hierarchy.
 */
export const PROVISIONING_ERROR_CODES = {
  /** 409 — admin email already exists on a core user. */
  emailInUse: "EMAIL_IN_USE",
  /** 422 — plan unknown or inactive. */
  planInvalid: "PLAN_INVALID",
  /** 409 — no free subdomain could be allocated. */
  subdomainUnavailable: "SUBDOMAIN_UNAVAILABLE",
  /** 5xx fallback for any other CoreProvisioningError. */
  unknown: "CORE_PROVISIONING_ERROR",
} as const;

export type ProvisioningErrorCode =
  (typeof PROVISIONING_ERROR_CODES)[keyof typeof PROVISIONING_ERROR_CODES];

export interface ProvisioningErrorBody {
  code: ProvisioningErrorCode | string;
  message: string;
  /** Present when code === EMAIL_IN_USE. */
  email?: string;
  /** Present when code === PLAN_INVALID. */
  planId?: string;
}
