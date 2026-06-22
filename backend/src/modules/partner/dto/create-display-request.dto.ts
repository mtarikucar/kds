import { IsOptional, IsString, MaxLength } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Body for POST /v1/display/waiter-requests and /v1/display/bill-requests.
 * Carries NO sessionId / tableId — the server supplies those from the
 * authenticated screen token (req.screen.orderingSessionId / tableId).
 */
export class CreateDisplayRequestDto {
  @ApiPropertyOptional({ example: "We need extra plates" })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  message?: string;
}
