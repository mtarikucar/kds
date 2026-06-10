import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CoreProvisioningPort,
} from '../core-contracts/provisioning/tenant-provisioning.port';
import {
  ProvisionTenantForLeadCommand,
  ProvisionTenantForLeadResult,
  ProvisionedLeadRecord,
  PlanSnapshot,
  CoreProvisioningError,
  CoreProvisioningEmailInUseError,
  CoreProvisioningPlanInvalidError,
  CoreProvisioningSubdomainError,
} from '../core-contracts/provisioning/tenant-provisioning.types';
import {
  DescribePlanRequest,
  DescribePlanResponse,
  INTERNAL_PROVISIONING_ROUTES,
  ListProvisionedLeadsRequest,
  ListProvisionedLeadsResponse,
  PROVISIONING_ERROR_CODES,
} from '../core-contracts/provisioning/http-contract';
import { INTERNAL_TOKEN_HEADER } from '../core-contracts/internal-http.contract';

/**
 * Phase-5 network client for {@link CoreProvisioningPort}. The in-process
 * TenantProvisioningService stayed with CORE; marketing now reaches it over
 * HTTP at `${CORE_SERVICE_URL}/api/internal/provisioning/*`, authenticated
 * with the shared `x-internal-token` service token (mirrors IngestTokenGuard
 * on the receiving side).
 *
 * Transport follows the canonical contract in
 * core-contracts/provisioning/http-contract: every call is POST + JSON body,
 * every success is 200 with a JSON envelope (`{ leads }`, `{ plan | null }`),
 * so a 404 from these routes is always a real error (wrong URL / wrong
 * deployment), never a semantic "not found".
 *
 * Error contract: core's internal endpoints return non-2xx with a structured
 * JSON body `{ code, message }`. The `code` field — NOT the HTTP status — is
 * mapped back onto the port-local error hierarchy so call sites
 * (MarketingLeadsService.convert) keep their existing instanceof handling
 * unchanged:
 *
 *   EMAIL_IN_USE          → CoreProvisioningEmailInUseError   (core sends 409)
 *   PLAN_INVALID          → CoreProvisioningPlanInvalidError  (core sends 422)
 *   SUBDOMAIN_UNAVAILABLE → CoreProvisioningSubdomainError    (core sends 409)
 *   anything else         → CoreProvisioningError             (5xx, unknown code)
 *
 * The port contract is fully serializable by design (no Prisma types, explicit
 * idempotency keys), so this client is a mechanical transport shim: dates go
 * out as ISO-8601 strings in the body, results come back as plain JSON.
 */
@Injectable()
export class HttpCoreProvisioningClient implements CoreProvisioningPort {
  private readonly logger = new Logger(HttpCoreProvisioningClient.name);
  // Provisioning is synchronous-by-contract (the converting manager waits on
  // it), but it creates tenant + user + subscription rows — give core room.
  private readonly TIMEOUT_MS = 30_000;

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    const url = this.config.get<string>('CORE_SERVICE_URL');
    if (!url) {
      throw new CoreProvisioningError(
        'CORE_SERVICE_URL is not configured — cannot reach the core provisioning service',
      );
    }
    return url.replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    const token = this.config.get<string>('INTERNAL_SERVICE_TOKEN');
    if (!token) {
      throw new CoreProvisioningError(
        'INTERNAL_SERVICE_TOKEN is not configured — refusing to call core unauthenticated',
      );
    }
    return {
      'Content-Type': 'application/json',
      [INTERNAL_TOKEN_HEADER]: token,
    };
  }

  async provisionTenantForLead(
    command: ProvisionTenantForLeadCommand,
  ): Promise<ProvisionTenantForLeadResult> {
    return (await this.post(
      INTERNAL_PROVISIONING_ROUTES.provisionTenantForLead,
      command,
    )) as ProvisionTenantForLeadResult;
  }

  async listProvisionedLeads(
    createdAfter: Date,
    createdBefore: Date,
  ): Promise<ProvisionedLeadRecord[]> {
    const body: ListProvisionedLeadsRequest = {
      createdAfter: createdAfter.toISOString(),
      createdBefore: createdBefore.toISOString(),
    };
    const result = (await this.post(
      INTERNAL_PROVISIONING_ROUTES.listProvisionedLeads,
      body,
    )) as ListProvisionedLeadsResponse | null;
    return result?.leads ?? [];
  }

  async describePlan(planId: string): Promise<PlanSnapshot | null> {
    const body: DescribePlanRequest = { planId };
    // Always 200 with the `{ plan }` envelope — `plan: null` for an unknown
    // plan. A 404 from this route is a real error (wrong URL), not "no plan".
    const result = (await this.post(
      INTERNAL_PROVISIONING_ROUTES.describePlan,
      body,
    )) as DescribePlanResponse | null;
    return result?.plan ?? null;
  }

  private async post(route: string, body: unknown): Promise<unknown> {
    const url = `${this.baseUrl}/api/${route}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.TIMEOUT_MS),
      });
    } catch (err) {
      // Network-level failure (DNS, refused, timeout). Transport-neutral
      // error so callers surface a 5xx instead of leaking fetch internals.
      this.logger.error(
        `core provisioning call POST /api/${route} failed: ${(err as Error).message}`,
      );
      throw new CoreProvisioningError(
        `Core provisioning service unreachable: ${(err as Error).message}`,
      );
    }

    if (response.ok) {
      if (response.status === 204) return null;
      return response.json();
    }

    const errBody = await response
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    const code = typeof errBody?.code === 'string' ? errBody.code : undefined;
    const message =
      typeof errBody?.message === 'string'
        ? errBody.message
        : `core provisioning returned HTTP ${response.status}`;

    switch (code) {
      case PROVISIONING_ERROR_CODES.emailInUse:
        throw new CoreProvisioningEmailInUseError(
          typeof errBody?.email === 'string' ? errBody.email : '',
        );
      case PROVISIONING_ERROR_CODES.planInvalid:
        throw new CoreProvisioningPlanInvalidError(
          typeof errBody?.planId === 'string' ? errBody.planId : '',
        );
      case PROVISIONING_ERROR_CODES.subdomainUnavailable:
        throw new CoreProvisioningSubdomainError();
      default:
        this.logger.error(
          `core provisioning call POST /api/${route} → HTTP ${response.status} (code=${code ?? 'n/a'}): ${message}`,
        );
        throw new CoreProvisioningError(message);
    }
  }
}
