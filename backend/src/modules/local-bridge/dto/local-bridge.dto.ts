import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * iter-63 — these three DTOs replace inline `@Body() body: { … }` types
 * on LocalBridgeController. NestJS's ValidationPipe only fires on
 * DTO *classes*; inline TS types are erased at runtime, so every
 * field flowed through unvalidated.
 *
 * The load-bearing case is `ClaimBridgeDto.provisioningToken`. The
 * /v1/bridges/claim endpoint is @Public — anyone on the internet can
 * POST to it. The service hands the raw token to crypto.createHash
 * (sha256) which processes the FULL input regardless of length. An
 * attacker throwing 100MB strings at the default throttle (≈100/min)
 * burns measurable CPU per request. The natural token is
 * `${uuidv7}.${base64url(32 bytes)}` ≈ 80 chars; 128 is generous
 * headroom while shutting the amplification window.
 *
 * hostname / os / agentVersion are persisted on LocalBridgeAgent
 * columns — Postgres TEXT, no implicit ceiling.
 */

const FIELD_MAX = 200;
const TOKEN_MAX = 128;

export class CreateBridgeSlotDto {
  @ApiProperty({ description: "Branch the bridge belongs to" })
  @IsUUID()
  branchId: string;

  @ApiPropertyOptional({
    description: "Product SKU printed on the packing slip",
  })
  @IsOptional()
  @IsString()
  @MaxLength(FIELD_MAX)
  productSku?: string;

  @ApiPropertyOptional({
    description: "Initial hostname hint (admin-supplied)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(FIELD_MAX)
  hostname?: string;
}

export class ClaimBridgeDto {
  @ApiProperty({
    description:
      "One-time provisioning token (shown to operator once at order fulfillment)",
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(16)
  @MaxLength(TOKEN_MAX)
  provisioningToken: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(FIELD_MAX)
  hostname?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(FIELD_MAX)
  os?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(FIELD_MAX)
  agentVersion?: string;
}

export class BridgeHeartbeatDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(FIELD_MAX)
  hostname?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(FIELD_MAX)
  os?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(FIELD_MAX)
  agentVersion?: string;
}
