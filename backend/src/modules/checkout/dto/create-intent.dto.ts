import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CartDto } from "./cart.dto";
import { NormalizePhone } from "../../../common/dto/normalize-phone";
import { E164_PATTERN } from "../../../common/phone/e164.const";

// v2.8.85 — input contract for `POST /v1/checkout/intent`.
//
// The intent endpoint trades a cart for a PayTR iframe token. The buyer
// info (email/name/phone) is what PayTR sees on the hosted page and what
// gets weighted in their fraud-scoring — therefore the caller MUST supply
// real values. We *could* default these from `req.user`, but the admin
// using the dashboard isn't always the person who'll fill out the iframe
// (procurement vs. finance), so the UI passes them in explicitly.

// PayTR limits user_name + user_address + user_phone to 60 chars each.
// 80 leaves a little overhead for any client-side display labelling we
// might prepend, while still bounding payload size.
const NAME_MAX = 80;
const PHONE_MAX = 32;
const ADDRESS_MAX = 240;
const EMAIL_MAX = 254;

export class CheckoutBuyerDto {
  @ApiProperty({ maxLength: EMAIL_MAX })
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;

  @ApiProperty({ maxLength: NAME_MAX })
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX)
  name!: string;

  // Phone is NORMALIZED to E.164 (NormalizePhone) before validation, so the
  // buyer can type any natural format TR numbers come through in — "0555 123
  // 45 67", "+90 555 123 45 67", "(0555) 123-45-67" — and it lands as
  // "+905551234567" (the canonical value PayTR's fraud-scoring prefers). An
  // unparseable value passes through untouched and fails the E.164 check
  // below with a clear message.
  @ApiProperty({ maxLength: PHONE_MAX })
  @NormalizePhone()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PHONE_MAX)
  @Matches(E164_PATTERN, {
    message: "Lütfen geçerli bir telefon numarası girin.",
  })
  phone!: string;

  @ApiPropertyOptional({ maxLength: ADDRESS_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(ADDRESS_MAX)
  address?: string;
}

export class CreateCheckoutIntentDto {
  @ApiProperty({ type: CartDto })
  @ValidateNested()
  @Type(() => CartDto)
  cart!: CartDto;

  @ApiProperty({ type: CheckoutBuyerDto })
  @ValidateNested()
  @Type(() => CheckoutBuyerDto)
  buyer!: CheckoutBuyerDto;

  // Optional gateway return URL. The frontend supplies the page it wants
  // the buyer redirected to after the iframe closes. If absent the
  // adapter falls back to a default OK/FAIL URL.
  //
  // This value becomes PayTR's post-payment OK/FAIL redirect target, so it
  // must be an absolute http(s) URL — reject javascript:/data:/protocol-
  // relative forms that would turn the payment return into an open redirect.
  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^https?:\/\/\S+$/i, {
    message: "returnUrl must be an absolute http(s) URL",
  })
  returnUrl?: string;

  // v2.8.99.3 — optional branch reference for hardware-store checkouts.
  // When the buyer picks "Ship to my branch" in the shipping form, the
  // SPA passes the chosen branchId here AND copies the branch address
  // into `cart.shippingAddress` (snapshot). Backend validates the
  // branch belongs to the caller's tenant and is `status='active'`
  // before persisting onto HardwareOrder.branchId — see
  // checkout.service.confirmAndProvision. Optional because the manual
  // address mode and non-hardware checkouts (plan/addon-only) don't
  // carry a branch reference.
  @ApiPropertyOptional({
    description:
      "Tenant-owned branch the order ships to (snapshot only — see checkout.service)",
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  // v3.3.0 — marketing-rep attribution, mirroring the subscription rail's
  // CreatePaymentIntentDto.referralCode. Resolved through
  // ReferralDirectoryPort and snapshotted onto the CheckoutIntent at intent
  // time so a later code rotation cannot re-attribute a past sale. Without
  // it the checkout rail has no referral to put on the PaymentSucceeded
  // event, and once the subscription rail retires rep commissions would
  // silently drop to zero.
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  referralCode?: string;

  /**
   * The three current legal documents the buyer ticked: KVKK, Mesafeli Satış
   * and İade Politikası.
   *
   * Mirrors the contract the retired /payments/create-intent enforced. The ids
   * are verified against the `isCurrent=true` rows and three Consent records
   * are written — with ip and user-agent — before any PayTR token is minted,
   * so a sale always has evidence the terms were shown in the version that was
   * live at the time. Ids come from `/legal/documents/:kind/current`.
   */
  @ApiProperty({ type: [String], minItems: 3, maxItems: 3 })
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsUUID("all", { each: true })
  acceptedDocumentIds!: string[];
}
