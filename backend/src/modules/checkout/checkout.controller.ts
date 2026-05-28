import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';
import { QuoteService } from './quote.service';
import { CheckoutService } from './checkout.service';
import { CartDto, ConfirmCheckoutDto } from './dto/cart.dto';
import type { Cart } from './checkout.types';

@ApiTags('Checkout')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/checkout')
export class CheckoutController {
  constructor(
    private readonly quoteSvc: QuoteService,
    private readonly checkoutSvc: CheckoutService,
  ) {}

  // /quote is read-only: it prices a hypothetical cart, writes nothing.
  // Any authenticated tenant user can see prices for budgeting / preview;
  // role-gating starts at /start (creates state) and /confirm (provisions).
  @Post('quote')
  @ApiOperation({ summary: 'Price a mixed cart (plan + add-ons + hardware + service). No DB writes.' })
  quote(@Body() cart: CartDto) {
    // Cart's items[] uses a discriminated union (CartItemPlan|AddOn|Hardware|
    // Service) for the in-engine type-narrowing; CartDto carries the wider
    // type because class-validator can't express discriminated unions at
    // runtime. The DTO has already been validated by ValidationPipe so the
    // cast is safe.
    return this.quoteSvc.quote(cart as unknown as Cart);
  }

  @Post('start')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      'Lock in a quote ahead of redirecting to the payment gateway (ADMIN, MANAGER).',
  })
  async start(@Req() req: any, @Body() cart: CartDto) {
    // MVP: provisioning happens at confirm-and-pay (next endpoint). `start`
    // is a no-op aside from re-pricing; preserved as a stable endpoint that
    // the UI can call to lock in the quote before redirecting to the payment
    // gateway. Iter-88 restricted to ADMIN/MANAGER since pricing snapshots
    // tie into the subscription/hardware-order audit trail.
    return this.quoteSvc.quote(cart as unknown as Cart);
  }

  // Iter-88: confirmAndProvision allocates stock, mints HardwareOrder rows,
  // and queues subscription.upgrade.requested events. Pre-iter-88 the
  // endpoint only required JwtAuthGuard, so a WAITER could replay a forged
  // paymentRef and provision hardware against their tenant. Restrict to
  // ADMIN/MANAGER and validate the payload via ConfirmCheckoutDto. The
  // gateway-side payment verification (matching paymentRef to a real
  // SUCCEEDED SubscriptionPayment row) lands in v2.8.85 (#39) — for now the
  // DTO+role guard close the broadest privilege gap.
  @Post('confirm')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      'Confirm a paid cart (ADMIN, MANAGER). Idempotent on (tenant, paymentRef).',
  })
  confirm(@Req() req: any, @Body() body: ConfirmCheckoutDto) {
    return this.checkoutSvc.confirmAndProvision(
      req.user.tenantId,
      body.cart as unknown as Cart,
      body.paymentRef,
    );
  }
}
