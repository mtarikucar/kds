import { Controller, Post, Get, Body, Req, HttpCode } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PaymentsService } from "./payments.service";
import { BankTransferService } from "./services/bank-transfer.service";
import { CreateIntentDto } from "./dto/create-intent.dto";
import { CreateBankTransferIntentDto } from "./dto/bank-transfer.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { getClientIp } from "../../common/helpers/client-ip.helper";

/**
 * Subscription-payment intents. JwtAuthGuard / TenantGuard / RolesGuard
 * are applied globally via APP_GUARD in AuthModule, so no per-controller
 * @UseGuards is required.
 */
@ApiTags("payments")
@ApiBearerAuth()
@Controller("payments")
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly bankTransfer: BankTransferService,
  ) {}

  @Post("create-intent")
  @HttpCode(200)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  // Override the default 100/minute "long" throttle — each intent
  // creates a PENDING SubscriptionPayment + (possibly) a PENDING
  // Subscription + calls PayTR's get-token. A rapid-click attacker
  // could otherwise burn orphan rows and hammer PayTR's API. Five
  // attempts per minute is plenty for a real user retrying after
  // a typo.
  @Throttle({ long: { ttl: 60_000, limit: 5 } })
  async createIntent(@Body() dto: CreateIntentDto, @Req() req: any) {
    // Use the shared helper: req.ip first (Express resolves through the
    // app-level trust-proxy chain), then a raw XFF parse as a fallback
    // for environments where Express couldn't populate it. The earlier
    // XFF-first read meant the IP stamped on KVKK consent audit rows
    // could be set by the client; that's a forensic gap, not a security
    // boundary, but auditors still ask why the recorded IP differs
    // from the connection-level IP, and the answer can't be "trust
    // the client".
    const userIp = getClientIp(req) || req.socket?.remoteAddress || "0.0.0.0";
    // userAgent feeds into the Consent audit row alongside ip. KVKK
    // expects "kim onayladı, hangi cihazdan" answerable later.
    const userAgent =
      typeof req.headers["user-agent"] === "string"
        ? (req.headers["user-agent"] as string).slice(0, 500)
        : undefined;
    return this.payments.createIntent(
      req.user.tenantId,
      req.user.id,
      dto,
      userIp,
      userAgent,
    );
  }

  /** Public-facing platform bank details for the checkout havale screen. */
  @Get("bank-transfer/details")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async bankTransferDetails() {
    return this.bankTransfer.getPublicDetails();
  }

  /** Reserve a manual bank-transfer (havale) payment for a plan. */
  @Post("bank-transfer/intent")
  @HttpCode(200)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Throttle({ long: { ttl: 60_000, limit: 5 } })
  async bankTransferIntent(
    @Body() dto: CreateBankTransferIntentDto,
    @Req() req: any,
  ) {
    const userIp = getClientIp(req) || req.socket?.remoteAddress || "0.0.0.0";
    const userAgent =
      typeof req.headers["user-agent"] === "string"
        ? (req.headers["user-agent"] as string).slice(0, 500)
        : undefined;
    return this.bankTransfer.createIntent({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      planId: dto.planId,
      billingCycle: dto.billingCycle,
      acceptedDocumentIds: dto.acceptedDocumentIds,
      userIp,
      userAgent,
    });
  }
}
