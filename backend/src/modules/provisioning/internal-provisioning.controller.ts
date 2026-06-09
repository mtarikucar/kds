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
  ProvisionTenantForLeadCommand,
} from "../../core-contracts/provisioning/tenant-provisioning.types";

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

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "CORE_PROVISIONING_ERROR";
    const extra: Record<string, unknown> = {};

    if (exception instanceof CoreProvisioningEmailInUseError) {
      status = HttpStatus.CONFLICT;
      code = "EMAIL_IN_USE";
      extra.email = exception.email;
    } else if (exception instanceof CoreProvisioningPlanInvalidError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = "PLAN_INVALID";
      extra.planId = exception.planId;
    } else if (exception instanceof CoreProvisioningSubdomainError) {
      status = HttpStatus.CONFLICT;
      code = "SUBDOMAIN_UNAVAILABLE";
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
@Controller("internal/provisioning")
@Public()
@SkipThrottle()
@UseGuards(InternalServiceTokenGuard)
@UseFilters(CoreProvisioningErrorFilter)
export class InternalProvisioningController {
  constructor(private readonly provisioning: TenantProvisioningService) {}

  /** CoreProvisioningPort.provisionTenantForLead */
  @Post("provision-tenant-for-lead")
  @HttpCode(200)
  async provisionTenantForLead(@Body() command: ProvisionTenantForLeadCommand) {
    if (!command?.leadId || !command?.idempotencyKey) {
      throw new BadRequestException("leadId and idempotencyKey are required");
    }
    return this.provisioning.provisionTenantForLead(command);
  }

  /** CoreProvisioningPort.listProvisionedLeads */
  @Post("list-provisioned-leads")
  @HttpCode(200)
  async listProvisionedLeads(
    @Body() body: { createdAfter: string; createdBefore: string },
  ) {
    const createdAfter = new Date(body?.createdAfter);
    const createdBefore = new Date(body?.createdBefore);
    if (
      Number.isNaN(createdAfter.getTime()) ||
      Number.isNaN(createdBefore.getTime())
    ) {
      throw new BadRequestException(
        "createdAfter and createdBefore must be ISO-8601 dates",
      );
    }
    return this.provisioning.listProvisionedLeads(createdAfter, createdBefore);
  }

  /** CoreProvisioningPort.describePlan — null body for an unknown plan. */
  @Post("describe-plan")
  @HttpCode(200)
  async describePlan(@Body() body: { planId: string }) {
    if (!body?.planId) {
      throw new BadRequestException("planId is required");
    }
    return this.provisioning.describePlan(body.planId);
  }
}
