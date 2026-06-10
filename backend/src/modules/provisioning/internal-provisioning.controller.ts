import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  HttpCode,
  HttpStatus,
  Post,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { SkipThrottle } from "@nestjs/throttler";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../auth/decorators/public.decorator";
import { InternalServiceTokenGuard } from "../../common/guards/internal-service-token.guard";
import { TenantProvisioningService } from "./tenant-provisioning.service";
import {
  CoreProvisioningEmailInUseError,
  CoreProvisioningError,
  CoreProvisioningPlanInvalidError,
  CoreProvisioningSubdomainError,
} from "../../core-contracts/provisioning/tenant-provisioning.types";
import {
  DescribePlanRequest,
  DescribePlanResponse,
  INTERNAL_PROVISIONING_BASE,
  INTERNAL_PROVISIONING_SEGMENTS,
  ListProvisionedLeadsRequest,
  ListProvisionedLeadsResponse,
  PROVISIONING_ERROR_CODES,
  ProvisionTenantForLeadRequest,
} from "../../core-contracts/provisioning/http-contract";

/**
 * Maps the transport-neutral CoreProvisioning* error hierarchy onto HTTP
 * status + a structured `{code, message}` body, exactly as prescribed by the
 * Phase-5 runbook ("Map the port-local errors to/from HTTP status + a
 * structured code"). The kds-marketing HttpCoreProvisioningClient reads
 * `code` to rehydrate the matching typed error on its side, so neither
 * service leaks framework exceptions across the boundary.
 *
 * Scoped to this controller (not global) — everything else keeps the
 * standard HttpExceptionFilter envelope.
 */
@Catch(CoreProvisioningError)
export class CoreProvisioningErrorFilter implements ExceptionFilter {
  catch(exception: CoreProvisioningError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = PROVISIONING_ERROR_CODES.unknown;
    const extra: Record<string, unknown> = {};

    if (exception instanceof CoreProvisioningEmailInUseError) {
      status = HttpStatus.CONFLICT;
      code = PROVISIONING_ERROR_CODES.emailInUse;
      extra.email = exception.email;
    } else if (exception instanceof CoreProvisioningPlanInvalidError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = PROVISIONING_ERROR_CODES.planInvalid;
      extra.planId = exception.planId;
    } else if (exception instanceof CoreProvisioningSubdomainError) {
      status = HttpStatus.CONFLICT;
      code = PROVISIONING_ERROR_CODES.subdomainUnavailable;
    }

    response.status(status).json({
      code,
      message: exception.message,
      ...extra,
    });
  }
}

/**
 * Core's server side of {@link CoreProvisioningPort} for the Phase-5
 * physical split: one route per port method, wrapping the same
 * TenantProvisioningService that used to be bound in-process. The
 * kds-marketing service consumes these via its HttpCoreProvisioningClient.
 *
 * Auth: service-to-service only — InternalServiceTokenGuard checks the
 * `x-internal-token` header against INTERNAL_SERVICE_TOKEN (503 when core
 * isn't configured for the split yet). `@Public()` opts out of the global
 * tenant-JWT pipeline (which would 401 before the token check runs);
 * `@SkipThrottle()` because the reconciliation sweep is machine traffic,
 * not a browser.
 */
@ApiExcludeController()
@Controller(INTERNAL_PROVISIONING_BASE)
@Public()
@SkipThrottle()
@UseGuards(InternalServiceTokenGuard)
@UseFilters(CoreProvisioningErrorFilter)
export class InternalProvisioningController {
  constructor(private readonly provisioning: TenantProvisioningService) {}

  /** CoreProvisioningPort.provisionTenantForLead */
  @Post(INTERNAL_PROVISIONING_SEGMENTS.provisionTenantForLead)
  @HttpCode(200)
  async provisionTenantForLead(@Body() command: ProvisionTenantForLeadRequest) {
    if (!command?.leadId || !command?.idempotencyKey) {
      throw new BadRequestException("leadId and idempotencyKey are required");
    }
    return this.provisioning.provisionTenantForLead(command);
  }

  /** CoreProvisioningPort.listProvisionedLeads */
  @Post(INTERNAL_PROVISIONING_SEGMENTS.listProvisionedLeads)
  @HttpCode(200)
  async listProvisionedLeads(
    @Body() body: ListProvisionedLeadsRequest,
  ): Promise<ListProvisionedLeadsResponse> {
    const createdAfter = parseIsoDate(body?.createdAfter);
    const createdBefore = parseIsoDate(body?.createdBefore);
    if (!createdAfter || !createdBefore) {
      throw new BadRequestException(
        "createdAfter and createdBefore must be ISO-8601 date strings",
      );
    }
    const leads = await this.provisioning.listProvisionedLeads(
      createdAfter,
      createdBefore,
    );
    return { leads };
  }

  /**
   * CoreProvisioningPort.describePlan — always 200 with the
   * `{ plan: ... | null }` envelope; `plan: null` for an unknown plan
   * (never an empty body, never a 404).
   */
  @Post(INTERNAL_PROVISIONING_SEGMENTS.describePlan)
  @HttpCode(200)
  async describePlan(
    @Body() body: DescribePlanRequest,
  ): Promise<DescribePlanResponse> {
    if (!body?.planId) {
      throw new BadRequestException("planId is required");
    }
    const plan = await this.provisioning.describePlan(body.planId);
    return { plan };
  }
}

/**
 * Conservative ISO-8601 check: `YYYY-MM-DD` with an optional time part.
 * `new Date(x)` alone is NOT a validator — `new Date(null)` is the epoch and
 * `new Date(12345)` is a timestamp, so non-string JSON values would slip
 * through a NaN check and silently become surprising ranges.
 */
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_8601.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
