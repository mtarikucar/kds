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
import { E164_PATTERN } from "../../../common/phone/e164.const";

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
  @NormalizePhone()
  @IsString()
  @IsOptional()
  @MaxLength(20)
  @Matches(E164_PATTERN, {
    message: "customerPhone must be in E.164 format, e.g. +905551234567",
  })
  customerPhone?: string;
}
