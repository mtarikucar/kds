import {
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Body for `POST /superadmin/subscriptions/:id/refund`.
 *
 * `amount` is optional — when omitted, the full SubscriptionPayment
 * amount is refunded. A partial refund (`amount < payment.amount`)
 * still terminalises the payment row to REFUNDED, because the schema
 * doesn't currently track partial refund state separately. The exact
 * refunded amount is preserved in the SuperAdminAuditLog entry.
 */
export class RefundSubscriptionPaymentDto {
  @ApiProperty({ description: "SubscriptionPayment id to refund." })
  @IsUUID()
  paymentId!: string;

  @ApiPropertyOptional({
    description:
      "Partial refund amount in TRY. Omit for a full refund of the original payment amount.",
  })
  @IsOptional()
  @IsPositive()
  amount?: number;

  @ApiProperty({
    description: "Free-text refund reason, logged to the audit trail.",
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
