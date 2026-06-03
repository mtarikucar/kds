import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Customer-session token shape: 32 random bytes encoded as hex = exactly
 * 64 lower-hex chars. The previous `@Length(32, 128)` slot accepted any
 * 32-128 char string — a sloppy bound that let an attacker post arbitrary
 * payloads through the @Public surface (each one still rejected
 * downstream when the DB lookup fails, but waste DB roundtrips). Tight
 * shape gate stops malformed strings at the boundary.
 */
const SESSION_ID_REGEX = /^[0-9a-f]{64}$/;

export class CreateWaiterRequestDto {
  @ApiPropertyOptional({
    description: "Table ID; optional for tableless (counter) orders",
  })
  @IsOptional()
  @IsUUID()
  tableId?: string;

  @ApiProperty()
  @IsString()
  @Length(64, 64)
  @Matches(SESSION_ID_REGEX, {
    message: "sessionId must be a 64-char lower-hex string",
  })
  sessionId: string;

  @ApiPropertyOptional({ example: "We need extra plates" })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  message?: string;
}

export class CreateBillRequestDto {
  @ApiPropertyOptional({
    description: "Table ID; optional for tableless (counter) orders",
  })
  @IsOptional()
  @IsUUID()
  tableId?: string;

  @ApiProperty()
  @IsString()
  @Length(64, 64)
  @Matches(SESSION_ID_REGEX, {
    message: "sessionId must be a 64-char lower-hex string",
  })
  sessionId: string;
}
