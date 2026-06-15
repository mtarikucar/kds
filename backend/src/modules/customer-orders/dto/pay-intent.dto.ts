import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { EmptyStringToUndefined } from "../../../common/dto/transforms";
import { NormalizePhone } from "../../../common/dto/normalize-phone";

// E.164-ish: 8-15 digits, optional leading +. Mirrors the regex used in
// orders/dto/create-payment.dto.ts and customer-orders/dto/create-customer-order.dto.ts
// — every surface that funnels into findOrCreateByPhone must validate
// against the same shape so the canonical Customer.phone column never
// inherits junk from an unvalidated entry path.
const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

/**
 * One OrderItem the customer wants to settle. The server already
 * knows the price; the client cannot tamper with it (DTO has no
 * amount/price field by design).
 */
export class CustomerPayItemEntry {
  @ApiProperty({ description: "OrderItem the customer is paying for" })
  @IsUUID()
  orderItemId: string;

  @ApiProperty({ description: "Number of units to settle", minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

/**
 * Body for POST /customer-orders/sessions/:sid/pay-intent.
 * SessionId comes from the URL param so the server can resolve
 * tenantId from CustomerSession — never from the body.
 */
export class CreatePayIntentDto {
  @ApiProperty({
    description: "Items (and quantities) the customer wants to pay for now",
    type: [CustomerPayItemEntry],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CustomerPayItemEntry)
  items: CustomerPayItemEntry[];

  @ApiPropertyOptional({
    description:
      "Optional customer phone — links the resulting Payment to a Customer row for loyalty.",
  })
  @EmptyStringToUndefined()
  @NormalizePhone("TR")
  @IsString()
  @IsOptional()
  @MaxLength(20)
  @Matches(PHONE_REGEX, {
    message: "customerPhone must match E.164 shape (8-15 digits, optional +)",
  })
  customerPhone?: string;
}
