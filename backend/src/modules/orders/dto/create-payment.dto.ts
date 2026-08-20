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
import { E164_PATTERN } from "../../../common/phone/e164.const";

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

  // Tip recorded with this payment (informational, not part of `amount`).
  // Drives the tips report + payroll.
  @ApiPropertyOptional({ description: "Tip amount recorded with this payment" })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  @IsOptional()
  tipAmount?: number;

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
  @Matches(E164_PATTERN, {
    message: "customerPhone must be in E.164 format, e.g. +905551234567",
  })
  customerPhone?: string;
}
