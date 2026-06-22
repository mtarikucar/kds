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

// E.164-ish: 8-15 digits, optional leading +. Mirrors pay-intent.dto.ts.
const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

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
  @NormalizePhone("TR")
  @IsString()
  @IsOptional()
  @MaxLength(20)
  @Matches(PHONE_REGEX, {
    message: "customerPhone must match E.164 shape (8-15 digits, optional +)",
  })
  customerPhone?: string;
}
