import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Iter-88: the checkout controller previously accepted `@Body() cart: Cart`
// where Cart was a *TypeScript interface*, not a class-validator DTO. Nest's
// ValidationPipe is a no-op for plain TS interfaces — the payload flows
// straight through. Combined with the fact that the controller only carries
// JwtAuthGuard (no @Roles) any authenticated tenant user could post arbitrary
// items into `quoteSvc.quote` and, more dangerously, into
// `checkoutSvc.confirmAndProvision` with any string they liked as paymentRef.
// These DTOs lock the input boundary; the role-gating happens at the
// controller level.

// Item codes (plan/addon/service) are short identifiers — 64 is plenty.
const CODE_MAX = 64;
// SKU codes for hardware — same shape as the catalog SKU enum.
const SKU_MAX = 64;
// Per-line qty cap — anyone ordering >999 of one line goes through sales,
// not self-serve. Also bounds the per-line work the quote engine has to do
// (catalog lookup, addon dependency check, etc.).
const QTY_MAX = 999;
// Hard cap on items per cart so a single request can't tie up the quote
// pipeline for seconds.
const ITEMS_MAX = 50;
// paymentRef on the success-page path is supplied by the client and stored
// as-is. PayTR merchant_oid is short (~40 chars); Stripe payment intent ids
// are 27. 128 leaves room for future gateways but stops a megabyte payload
// from being persisted on every confirm.
const PAYMENT_REF_MAX = 128;
// Coupon codes in the marketing flow are short alphanumeric handles.
const COUPON_MAX = 64;

export class CartItemDto {
  @ApiProperty({ enum: ['plan', 'addon', 'hardware', 'service'] })
  @IsIn(['plan', 'addon', 'hardware', 'service'])
  type!: 'plan' | 'addon' | 'hardware' | 'service';

  // `code` for plan/addon/service; `sku` for hardware. The quote engine
  // picks the right one based on `type`. Either may be absent for `hardware`
  // (which uses sku) or present for the others — class-validator can't
  // express the cross-field rule cleanly, so we cap both fields and let
  // the engine raise BadRequest if neither matches.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(CODE_MAX)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(SKU_MAX)
  sku?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: QTY_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(QTY_MAX)
  qty?: number;

  @ApiPropertyOptional({ enum: ['MONTHLY', 'YEARLY'] })
  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  billingCycle?: 'MONTHLY' | 'YEARLY';

  @ApiPropertyOptional({ description: 'Branch UUID for branch-scoped addons / services' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: ['sell', 'rent'] })
  @IsOptional()
  @IsIn(['sell', 'rent'])
  acquisition?: 'sell' | 'rent';

  // v2.8.87: service-order scheduling intent. Optional (only meaningful
  // for service items; ignored for hardware/addon/plan). 1-3 dates so a
  // buyer can offer alternates without spamming the technician schedule.
  // CheckoutService reads these to populate InstallationRequest.preferredDates.
  @ApiPropertyOptional({ type: [String], format: 'date', maxItems: 3 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsDateString({}, { each: true })
  preferredDates?: string[];

  // v2.8.87: free-form buyer note carried into InstallationRequest.notes
  // (delivery instructions, contact person at venue, parking guidance).
  // 500 chars caps logging + storage footprint.
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CartDto {
  @ApiProperty({ type: [CartItemDto], minItems: 1, maxItems: ITEMS_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ITEMS_MAX)
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items!: CartItemDto[];

  // shipping/billingAddress are forwarded to the HardwareOrder row as a
  // Json column. We don't model the address shape here (that's the job of
  // the v2.8.84 shipping-address task) but we do require it be an object —
  // raw strings or arrays would corrupt the column type.
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  shippingAddress?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  billingAddress?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(COUPON_MAX)
  couponCode?: string;
}

export class ConfirmCheckoutDto {
  @ApiProperty({ type: CartDto })
  @ValidateNested()
  @Type(() => CartDto)
  cart!: CartDto;

  // paymentRef is the gateway-supplied id (PayTR merchant_oid / Stripe pi_…).
  // Iter-88 requires it non-empty so the empty-string case can't bypass the
  // idempotency lookup (the service guards on `if (paymentRef)`, so '' falls
  // through to fresh provisioning AS IF it were a paid order).
  @ApiProperty({ maxLength: PAYMENT_REF_MAX })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PAYMENT_REF_MAX)
  paymentRef!: string;
}
