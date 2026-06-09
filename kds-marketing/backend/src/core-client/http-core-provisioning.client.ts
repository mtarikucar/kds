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

/**
 * Phase-5 network client for {@link CoreProvisioningPort}. The in-process
 * TenantProvisioningService stayed with CORE; marketing now reaches it over
 * HTTP at `${CORE_SERVICE_URL}/api/internal/provisioning/*`, authenticated
 * with the shared `x-internal-token` service token (mirrors IngestTokenGuard
 * on the receiving side).
 *
 * Error contract: core's internal endpoints return non-2xx with a structured
 * JSON body `{ code, message }`. The `code` field — NOT the HTTP status — is
 * mapped back onto the port-local error hierarchy so call sites
 * (MarketingLeadsService.convert) keep their existing instanceof handling
 * unchanged:
 *
 *   EMAIL_IN_USE          → CoreProvisioningEmailInUseError   (core sends 409)
 *   PLAN_INVALID          → CoreProvisioningPlanInvalidError  (core sends 400)
 *   SUBDOMAIN_UNAVAILABLE → CoreProvisioningSubdomainError    (core sends 409)
 *   anything else         → CoreProvisioningError             (5xx, unknown code)
 *
 * The port contract is fully serializable by design (no Prisma types, explicit
 * idempotency keys), so this client is a mechanical transport shim: dates go
 * out as ISO-8601 query params, results come back as plain JSON.
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
      'x-internal-token': token,
    };
  }

  async provisionTenantForLead(
    command: ProvisionTenantForLeadCommand,
  ): Promise<ProvisionTenantForLeadResult> {
    return (await this.request(
      'POST',
      '/api/internal/provisioning/provision-tenant',
      command,
    )) as ProvisionTenantForLeadResult;
  }

  async listProvisionedLeads(
    createdAfter: Date,
    createdBefore: Date,
  ): Promise<ProvisionedLeadRecord[]> {
    const qs = new URLSearchParams({
      createdAfter: createdAfter.toISOString(),
      createdBefore: createdBefore.toISOString(),
    });
    const result = (await this.request(
      'GET',
      `/api/internal/provisioning/provisioned-leads?${qs.toString()}`,
    )) as ProvisionedLeadRecord[];
    return result ?? [];
  }

  async describePlan(planId: string): Promise<PlanSnapshot | null> {
    const result = (await this.request(
      'GET',
      `/api/internal/provisioning/plans/${encodeURIComponent(planId)}`,
      undefined,
      // Unknown plan is a null result by port contract, not an error.
      { allow404AsNull: true },
    )) as PlanSnapshot | null;
    return result ?? null;
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    opts?: { allow404AsNull?: boolean },
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.TIMEOUT_MS),
      });
    } catch (err) {
      // Network-level failure (DNS, refused, timeout). Transport-neutral
      // error so callers surface a 5xx instead of leaking fetch internals.
      this.logger.error(
        `core provisioning call ${method} ${path} failed: ${(err as Error).message}`,
      );
      throw new CoreProvisioningError(
        `Core provisioning service unreachable: ${(err as Error).message}`,
      );
    }

    if (response.ok) {
      if (response.status === 204) return null;
      return response.json();
    }

    if (response.status === 404 && opts?.allow404AsNull) return null;

    const errBody = await response
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    const code = typeof errBody?.code === 'string' ? errBody.code : undefined;
    const message =
      typeof errBody?.message === 'string'
        ? errBody.message
        : `core provisioning returned HTTP ${response.status}`;

    switch (code) {
      case 'EMAIL_IN_USE':
        throw new CoreProvisioningEmailInUseError(
          typeof errBody?.email === 'string' ? errBody.email : '',
        );
      case 'PLAN_INVALID':
        throw new CoreProvisioningPlanInvalidError(
          typeof errBody?.planId === 'string' ? errBody.planId : '',
        );
      case 'SUBDOMAIN_UNAVAILABLE':
        throw new CoreProvisioningSubdomainError();
      default:
        this.logger.error(
          `core provisioning call ${method} ${path} → HTTP ${response.status} (code=${code ?? 'n/a'}): ${message}`,
        );
        throw new CoreProvisioningError(message);
    }
  }
}
