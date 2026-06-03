import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaymentMethod } from "../../../common/constants/order-status.enum";
import { EmptyStringToUndefined } from "../../../common/dto/transforms";

// E.164-ish: 8-15 digits, optional leading +. Mirrors the regex in
// customer-orders/dto/create-customer-order.dto.ts so phones are
// validated consistently across every entry surface.
const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

export class CreatePaymentDto {
  // 10,000,000 currency-units cap. No legitimate restaurant order
  // reaches even 100k₺ in practice; the cap mostly catches typos
  // (extra zero) and the rare Number.MAX_SAFE_INTEGER kind of
  // garbage. The service has a remaining-amount gate that would
  // also catch overpayment, but DTO-level rejection avoids burning
  // a $transaction on obviously-broken input.
  @ApiProperty({
    description: "Payment amount",
    minimum: 0.01,
    maximum: 10_000_000,
  })
  @IsNumber()
  @Min(0.01)
  @Max(10_000_000)
  amount: number;

  @ApiProperty({ enum: PaymentMethod, description: "Payment method" })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  // 500 chars — generous for "Customer left a tip" / "Manager
  // discretion: comped dessert" but not a 100KB blob. Notes land
  // in the Payment audit row, which is reprinted on the receipt
  // snapshot and shows in admin lists.
  @ApiPropertyOptional({ description: "Payment notes" })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({
    description: "External gateway transaction identifier",
  })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @Length(1, 128)
  transactionId?: string;

  @ApiPropertyOptional({
    description:
      "Client-generated idempotency key. Retries sharing the same (orderId, idempotencyKey) return the existing payment instead of creating a duplicate.",
  })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @Length(8, 64)
  idempotencyKey?: string;

  // Same shape as the QR-menu CreateCustomerOrderDto — without this
  // an admin-side payment.create could persist a junk phone that
  // findOrCreateByPhone then uses as the canonical Customer.phone.
  @ApiPropertyOptional({
    description: "Customer phone for linking to customer record",
  })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(20)
  @Matches(PHONE_REGEX, {
    message: "customerPhone must match E.164 shape (8-15 digits, optional +)",
  })
  customerPhone?: string;
}
