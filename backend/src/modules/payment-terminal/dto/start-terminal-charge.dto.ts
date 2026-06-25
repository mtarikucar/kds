import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, IsOptional, IsString, Max, Min } from "class-validator";

export class StartTerminalChargeDto {
  // Same 0.01–10M envelope as CreatePaymentDto.amount.
  @ApiProperty({ example: 199.9 })
  @IsNumber()
  @Min(0.01)
  @Max(10_000_000)
  amount: number;

  // Dedupes the START so a double-click / network retry can't open two
  // charges (and thus can't double-charge the card).
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}
