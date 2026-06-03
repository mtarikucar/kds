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
  ArrayMinSize,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaymentMethod } from "../../../common/constants/order-status.enum";
import { EmptyStringToUndefined } from "../../../common/dto/transforms";

// E.164-ish: 8-15 digits, optional leading +. Same shape every other
// surface that feeds findOrCreateByPhone uses — keeps the canonical
// Customer.phone column from inheriting junk via the splitBill path.
const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

export enum SplitType {
  EQUAL = "EQUAL",
  BY_ITEMS = "BY_ITEMS",
  CUSTOM = "CUSTOM",
}

export class SplitPaymentEntry {
  @ApiProperty({ description: "Payment amount for this split" })
  @IsNumber()
  @Min(0.01)
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
  payments: SplitPaymentEntry[];

  @ApiPropertyOptional({ description: "Customer phone for linking" })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(20)
  @Matches(PHONE_REGEX, {
    message: "customerPhone must match E.164 shape (8-15 digits, optional +)",
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
