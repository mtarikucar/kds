import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Headers,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../../auth/decorators/public.decorator";
import { CustomerSelfPayService } from "../services/customer-self-pay.service";
import { CreatePayIntentDto } from "../dto/pay-intent.dto";
import { getClientIp } from "../../../common/helpers/client-ip.helper";

/**
 * Customer-facing self-pay endpoints. All routes are @Public — the
 * server authenticates the caller via sessionId in the URL and
 * resolves tenantId from CustomerSession (never from the body).
 */
@ApiTags("customer-self-pay")
@Controller("customer-orders/sessions/:sessionId")
@Public()
export class CustomerSelfPayController {
  constructor(private readonly service: CustomerSelfPayService) {}

  @Get("payable-items")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: "List unpaid items across all open orders at the session's table",
  })
  @ApiResponse({ status: 200, description: "Table-wide payable items" })
  @ApiResponse({ status: 404, description: "Session not found / expired" })
  getPayableItems(@Param("sessionId") sessionId: string) {
    return this.service.getPayableItemsForSession(sessionId);
  }

  @Post("pay-intent")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      "Create a PayTR hosted-iFrame intent for the items the customer selected",
  })
  @ApiResponse({
    status: 201,
    description: "Returns paymentLink to redirect the customer to",
  })
  @ApiResponse({
    status: 400,
    description:
      "Non-Turkey tenant, takeaway session, invalid item, or insufficient remaining quantity",
  })
  @ApiResponse({ status: 404, description: "Session not found / expired" })
  createIntent(
    @Param("sessionId") sessionId: string,
    @Body() dto: CreatePayIntentDto,
    @Req() req: any,
    @Headers("origin") origin?: string,
    @Headers("referer") referer?: string,
  ) {
    // Use the shared helper: req.ip resolves through Express's trust-
    // proxy chain (one LB hop), so the value is the upstream-supplied
    // client address — not anything the client itself can set. The
    // earlier "X-Forwarded-For first" read trusted client headers and
    // let the recorded IP on the consent / fiscal trail diverge from
    // the actual peer.
    const ip = getClientIp(req) || req?.connection?.remoteAddress || "0.0.0.0";
    // Origin lets the backend send PayTR's redirect URLs back to the
    // same host the QR menu was opened on (subdomain restaurants would
    // otherwise bounce back to the wrong host). Fall back to Referer
    // when Origin isn't sent (older WebViews).
    const returnOrigin =
      origin || (referer ? new URL(referer).origin : undefined);
    return this.service.createPayIntent(sessionId, dto, ip, returnOrigin);
  }

  @Get("pay-status")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "Poll the PendingSelfPayment row + return current remaining items",
  })
  @ApiResponse({ status: 200, description: "Status + remaining summary" })
  @ApiResponse({ status: 404, description: "Intent or session not found" })
  getStatus(
    @Param("sessionId") sessionId: string,
    @Query("oid") merchantOid: string,
  ) {
    return this.service.getPayStatus(sessionId, merchantOid);
  }
}
