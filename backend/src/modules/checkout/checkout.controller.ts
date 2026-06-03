import { Body, Controller, Ip, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { QuoteService } from "./quote.service";
import { CheckoutService } from "./checkout.service";
import { CheckoutIntentService } from "./checkout-intent.service";
import { CartDto, ConfirmCheckoutDto } from "./dto/cart.dto";
import { CreateCheckoutIntentDto } from "./dto/create-intent.dto";
import type { Cart } from "./checkout.types";

@ApiTags("Checkout")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/checkout")
export class CheckoutController {
  constructor(
    private readonly quoteSvc: QuoteService,
    private readonly checkoutSvc: CheckoutService,
    private readonly intentSvc: CheckoutIntentService,
  ) {}

  // /quote is read-only: it prices a hypothetical cart, writes nothing.
  // Any authenticated tenant user can see prices for budgeting / preview;
  // role-gating starts at /start (creates state) and /confirm (provisions).
  @Post("quote")
  @ApiOperation({
    summary:
      "Price a mixed cart (plan + add-ons + hardware + service). No DB writes.",
  })
  quote(@Body() cart: CartDto) {
    // Cart's items[] uses a discriminated union (CartItemPlan|AddOn|Hardware|
    // Service) for the in-engine type-narrowing; CartDto carries the wider
    // type because class-validator can't express discriminated unions at
    // runtime. The DTO has already been validated by ValidationPipe so the
    // cast is safe.
    return this.quoteSvc.quote(cart as unknown as Cart);
  }

  @Post("start")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "Lock in a quote ahead of redirecting to the payment gateway (ADMIN, MANAGER).",
  })
  async start(@Req() req: any, @Body() cart: CartDto) {
    // MVP: provisioning happens at confirm-and-pay (next endpoint). `start`
    // is a no-op aside from re-pricing; preserved as a stable endpoint that
    // the UI can call to lock in the quote before redirecting to the payment
    // gateway. Iter-88 restricted to ADMIN/MANAGER since pricing snapshots
    // tie into the subscription/hardware-order audit trail.
    return this.quoteSvc.quote(cart as unknown as Cart);
  }

  // v2.8.85: take a mixed cart and return a PayTR iframe token + paymentRef.
  // The endpoint trades the cart for a server-stashed CheckoutIntent row so
  // the asynchronous PayTR webhook (which only carries merchant_oid +
  // total_amount) can recover the cart and run confirmAndProvision. The
  // paymentRef the buyer's browser receives carries the "CK-" prefix; the
  // PayTR webhook dispatcher routes that prefix to CheckoutSettlementService.
  @Post("intent")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "Start a paid checkout — returns PayTR iframe token + paymentRef (ADMIN, MANAGER).",
  })
  intent(
    @Req() req: any,
    @Ip() buyerIp: string,
    @Body() body: CreateCheckoutIntentDto,
  ) {
    // v2.8.99.3 — fold the top-level branchId into the cart so it
    // round-trips through the persisted CheckoutIntent.cartJson and
    // is recoverable on confirm without a separate column. Validation
    // (tenant-owned + active branch) runs in confirmAndProvision so
    // the intent-time row stays cheap; the confirm path is where the
    // HardwareOrder.branchId actually gets written.
    return this.intentSvc.createIntent({
      tenantId: req.user.tenantId,
      cart: { ...(body.cart as unknown as Cart), branchId: body.branchId },
      buyer: body.buyer,
      buyerIp,
      returnUrl: body.returnUrl,
    });
  }

  // Iter-88: confirmAndProvision allocates stock, mints HardwareOrder rows,
  // and queues subscription.upgrade.requested events. Pre-iter-88 the
  // endpoint only required JwtAuthGuard, so a WAITER could replay a forged
  // paymentRef and provision hardware against their tenant. Restrict to
  // ADMIN/MANAGER and validate the payload via ConfirmCheckoutDto.
  //
  // v2.8.85: the production payment path is now /intent → PayTR iframe →
  // PaytrWebhookController dispatches CK- prefix → CheckoutSettlementService
  // → confirmAndProvision (so the user's browser never reaches /confirm
  // with a free-text paymentRef). /confirm stays as the admin-comp /
  // super-admin override path; the @Roles(ADMIN, MANAGER) gate keeps a
  // forged paymentRef from a tenant user from succeeding because the
  // matching CheckoutIntent row would not exist for arbitrary refs.
  @Post("confirm")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "Confirm a paid cart (ADMIN, MANAGER). Idempotent on (tenant, paymentRef).",
  })
  confirm(@Req() req: any, @Body() body: ConfirmCheckoutDto) {
    return this.checkoutSvc.confirmAndProvision(
      req.user.tenantId,
      body.cart as unknown as Cart,
      body.paymentRef,
    );
  }
}
