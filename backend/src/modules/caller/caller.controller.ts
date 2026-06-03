import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { PlanFeatureGuard } from "../subscriptions/guards/plan-feature.guard";
import { RequiresIntegration } from "../subscriptions/decorators/requires-integration.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { CallerService } from "./caller.service";
import { MockCallerProvider } from "./adapters/mock-caller.provider";

@ApiTags("Caller")
@Controller("v1/caller")
export class CallerController {
  constructor(
    private readonly caller: CallerService,
    private readonly mockProvider: MockCallerProvider,
  ) {}

  // v2.8.88: ADMIN/MANAGER only. The caller feed exposes inbound phone
  // numbers + matched customer profiles — PII that should not be open
  // to WAITER/KITCHEN. v2.8.90 adds @RequiresIntegration('caller') so
  // tenants who never bought the caller_id_integration add-on don't
  // see a sidebar entry advertising a feature they can't use, and the
  // backend mirrors the gate (defence in depth). The provider webhook
  // below stays @Public (it's HMAC-signed by the adapter).
  @UseGuards(JwtAuthGuard, RolesGuard, PlanFeatureGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresIntegration("caller")
  @ApiBearerAuth()
  @Get("recent")
  @ApiOperation({
    summary: "Last N caller events for the tenant — drives the calls feed UI",
  })
  recent(@Req() req: any, @Query("limit") limit?: string) {
    return this.caller.listRecent(
      req.user.tenantId,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  // Webhook receiver. Path includes the provider so we route to the right
  // adapter; tenant resolution happens via the URL param (the provider hands
  // out one webhook URL per tenant).
  //
  // The `mock` provider exists for CI + the dashboard "send test call"
  // button on dev/staging. Its parseWebhook ignores the x-signature
  // header — leaving the route reachable in prod lets any public caller
  // inject fabricated caller events into any tenant's feed just by
  // guessing tenant ids.
  //
  // v2.8.93 — the ALLOW_MOCK_CALLER_IN_PROD escape hatch is removed.
  // An accidentally-flipped env var should not be the difference
  // between "mock disabled" and "anyone can spoof any caller". If the
  // QA team needs synthetic calls in a prod-like env they should run
  // them against staging (NODE_ENV != production) or build a
  // SuperAdmin-authenticated test-event endpoint that bypasses the
  // public webhook surface entirely.
  // v2.8.94 — tight throttle. Pre-fix this was @Public with no rate
  // limit, so even though real providers HMAC-sign their callbacks an
  // attacker could spam the endpoint with random (providerId, tenantId)
  // pairs to enumerate live tenants by response-timing or to burn
  // adapter CPU on signature verification. 30/min is comfortably above
  // the busiest real-call rate while killing any practical brute-force.
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post("webhooks/:providerId/:tenantId")
  @ApiOperation({
    summary: "Provider-side webhook ingest. Signature verified by the adapter.",
  })
  async webhook(
    @Param("providerId") providerId: string,
    @Param("tenantId") tenantId: string,
    @Headers("x-signature") signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    let events: any[] = [];
    if (providerId === "mock") {
      if (process.env.NODE_ENV === "production") {
        throw new ForbiddenException(
          "Mock caller webhook is disabled in production.",
        );
      }
      events = await this.mockProvider.parseWebhook(signature, raw);
    } else {
      // TODO: registry lookup once more providers are added.
      events = [];
    }
    for (const ev of events) {
      await this.caller.ingest(tenantId, ev);
    }
    return { ingested: events.length };
  }
}
