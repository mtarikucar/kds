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
 * One OrderItem the screen wants to settle. The server already knows the
 * price; the client cannot tamper with it (no amount/price field by design).
 * Mirrors CustomerPayItemEntry from customer-orders/dto/pay-intent.dto.ts.
 */
export class DisplayPayItemEntry {
  @ApiProperty({ description: "OrderItem the screen is paying for" })
  @IsUUID()
  orderItemId: string;

  @ApiProperty({ description: "Number of units to settle", minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

/**
 * Body for POST /v1/display/pay-intent. Carries NO sessionId — the server
 * supplies it from the authenticated screen token (req.screen.orderingSessionId).
 */
export class CreateDisplayPayIntentDto {
  @ApiProperty({
    description: "Items (and quantities) to pay for now",
    type: [DisplayPayItemEntry],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DisplayPayItemEntry)
  items: DisplayPayItemEntry[];

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
