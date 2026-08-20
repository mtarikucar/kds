import {
  IsString,
  IsEnum,
  IsNumber,
  IsArray,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaymentMethod } from "../../../common/constants/order-status.enum";
import { EmptyStringToUndefined } from "../../../common/dto/transforms";
import { NormalizePhone } from "../../../common/dto/normalize-phone";
import { E164_PATTERN } from "../../../common/phone/e164.const";
import { MONEY_COLUMN_MAX } from "../../../common/money/money-column-bounds.const";

export enum SplitType {
  EQUAL = "EQUAL",
  BY_ITEMS = "BY_ITEMS",
  CUSTOM = "CUSTOM",
}

export class SplitPaymentEntry {
  @ApiProperty({ description: "Payment amount for this split" })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  // Bound to what Payment.amount (Decimal(14, 2)) can actually hold — see
  // money-column-bounds.const.ts. A split entry writes straight to that
  // column, so a narrower cap here would reject a value the DB accepts.
  @Max(MONEY_COLUMN_MAX)
  amount: number;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @ApiPropertyOptional({
    description: "Label for this split (e.g., person name)",
  })
  @IsString()
  @IsOptional()
  label?: string;

  @ApiPropertyOptional({
    description: "Order item IDs this split covers (for BY_ITEMS mode)",
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  orderItemIds?: string[];

  @ApiPropertyOptional({
    description:
      "Optional client-generated idempotency key. Send the same key on retries; the partial unique index payments_orderId_idempotencyKey_notnull_key dedupes server-side.",
  })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}

export class SplitBillDto {
  @ApiProperty({ enum: SplitType })
  @IsEnum(SplitType)
  splitType: SplitType;

  @ApiPropertyOptional({
    description: "Number of equal parts (for EQUAL mode)",
  })
  @IsNumber()
  @Min(2)
  @Max(200)
  @IsOptional()
  numberOfParts?: number;

  @ApiProperty({
    description: "Individual split payments",
    type: [SplitPaymentEntry],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SplitPaymentEntry)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  payments: SplitPaymentEntry[];

  @ApiPropertyOptional({ description: "Customer phone for linking" })
  @EmptyStringToUndefined()
  @NormalizePhone()
  @IsString()
  @IsOptional()
  @MaxLength(20)
  @Matches(E164_PATTERN, {
    message: "customerPhone must be in E.164 format, e.g. +905551234567",
  })
  customerPhone?: string;

  @ApiPropertyOptional({
    description:
      "Batch-level idempotency key for the whole split-bill operation. Combined with per-entry keys, this lets a retry recover the exact prior payment set instead of double-charging.",
  })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}

export class GroupBillSummaryDto {
  @ApiProperty({ description: "Table group ID" })
  @IsString()
  groupId: string;
}
