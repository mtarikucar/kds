import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaymentMethod } from "../../../common/constants/order-status.enum";
import { EmptyStringToUndefined } from "../../../common/dto/transforms";
import { NormalizePhone } from "../../../common/dto/normalize-phone";
import { E164_PATTERN } from "../../../common/phone/e164.const";

export class PayItemEntry {
  @ApiProperty({ description: "OrderItem the customer is paying for" })
  @IsUUID()
  orderItemId: string;

  @ApiProperty({
    description: "Number of units of this OrderItem to settle",
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class PayItemsDto {
  @ApiProperty({
    description: "Items (and quantities) the customer is paying for now",
    type: [PayItemEntry],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PayItemEntry)
  items: PayItemEntry[];

  @ApiProperty({ enum: PaymentMethod, description: "Payment method" })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @ApiPropertyOptional({
    description:
      "Free-form label persisted on Payment.notes (e.g., customer name on the bill).",
  })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @Length(1, 120)
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
      "Customer phone for linking to CRM record (used only when this payment closes the order)",
  })
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
      "Client-generated idempotency key. Retries sharing the same (orderId, idempotencyKey) return the existing payment row instead of creating a duplicate.",
  })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @Length(8, 64)
  idempotencyKey?: string;
}
