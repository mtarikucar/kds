import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { QuoteService } from './quote.service';
import { CheckoutService } from './checkout.service';
import { Cart } from './checkout.types';

@ApiTags('Checkout')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/checkout')
export class CheckoutController {
  constructor(
    private readonly quoteSvc: QuoteService,
    private readonly checkoutSvc: CheckoutService,
  ) {}

  @Post('quote')
  @ApiOperation({ summary: 'Price a mixed cart (plan + add-ons + hardware + service). No DB writes.' })
  quote(@Body() cart: Cart) {
    return this.quoteSvc.quote(cart);
  }

  @Post('start')
  @ApiOperation({
    summary:
      'Create a draft hardware order / pending add-ons; the payment intent is then created against the totalCents from the quote.',
  })
  async start(@Req() req: any, @Body() cart: Cart) {
    // MVP: provisioning happens at confirm-and-pay (next endpoint). `start`
    // is a no-op aside from re-pricing; preserved as a stable endpoint that
    // the UI can call to lock in the quote before redirecting to the payment
    // gateway.
    return this.quoteSvc.quote(cart);
  }

  @Post('confirm')
  @ApiOperation({
    summary:
      'Confirm a paid cart. `paymentRef` is the gateway reference (Iyzico/Stripe id). Idempotent on (tenant, paymentRef).',
  })
  confirm(
    @Req() req: any,
    @Body() body: { cart: Cart; paymentRef: string },
  ) {
    return this.checkoutSvc.confirmAndProvision(req.user.tenantId, body.cart, body.paymentRef);
  }
}
