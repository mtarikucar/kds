import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import type { CommandKind } from "../device-mesh.types";

// Canonical command kinds the bridge dispatcher actually executes. This MUST
// stay in lock-step with the `CommandKind` union (the `satisfies` below fails
// the build if they drift). Validating the DTO's `kind` against this closed
// set is load-bearing: the no-auto-requeue / double-charge guard in
// CommandQueueService keys on these exact underscore-form identifiers, so a
// free-form alias (e.g. `charge.card`) must never reach the queue.
const COMMAND_KINDS = [
  "print_receipt",
  "open_drawer",
  "fiscal_receipt",
  "fiscal_cancel",
  "charge_card",
  "show_order",
  "clear_order",
  "reboot",
  "firmware_update",
  "capability_probe",
  "noop",
] as const satisfies readonly CommandKind[];

const KINDS = [
  "tablet_waiter",
  "tablet_customer",
  "kds_screen",
  "bar_screen",
  "pos_terminal",
  "yazarkasa",
  "receipt_printer",
  "kitchen_printer",
  "caller_id",
  "scanner",
  "local_bridge",
] as const;

export class CreateDeviceSlotDto {
  @ApiProperty({ enum: KINDS })
  @IsIn(KINDS as any)
  kind!: (typeof KINDS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  branchId?: string;

  // Cap both the per-element string length and the array length so a
  // hostile admin (or a hijacked admin session) can't persist megabytes
  // into the JSONB column. 32 capabilities × 64 chars is plenty for any
  // realistic device profile (yazarkasa + printer + cash-drawer + …).
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  capabilities?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  serial?: string;

  @ApiPropertyOptional({ default: "byo" })
  @IsOptional()
  @IsIn(["sold", "rented", "byo"] as any)
  ownership?: "sold" | "rented" | "byo";
}

export class PairDeviceDto {
  // 6-character alphanumeric pair code shown to the operator. Keeping it
  // short and uppercase reduces typo rate; the random space is large
  // enough for a 10-minute TTL (36^6 = 2.2B).
  @ApiProperty({ example: "A4F9K2" })
  @IsString()
  @Length(6, 6)
  @Matches(/^[A-Z0-9]+$/)
  pairCode!: string;

  // Optional client metadata that surfaces in the admin device-detail view.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  serial?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  capabilities?: string[];
}

export class HeartbeatDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  batteryPct?: number;

  // IPv4 max 15 chars, IPv6 max 45. 64 covers both with headroom for
  // bracketed forms. Not @IsIP — devices behind NAT sometimes report
  // hostnames or container IDs in this field.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  agentVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  queueDepth?: number;
}

export class EnqueueCommandDto {
  // `kind` is a canonical CommandKind the bridge agent dispatches on
  // (`print_receipt`, `charge_card`, …). It MUST be one of the closed,
  // underscore-form set — free-form aliases (e.g. `charge.card`) would slip
  // past the double-charge / no-auto-requeue guard in CommandQueueService,
  // which keys on these exact identifiers, so we reject anything else here.
  @ApiProperty({ enum: COMMAND_KINDS })
  @IsString()
  @MaxLength(64)
  @IsIn(COMMAND_KINDS, {
    message: `kind must be one of: ${COMMAND_KINDS.join(", ")}`,
  })
  kind!: CommandKind;

  // Payload is JSONB; the body-parser limit (currently 100KB on this
  // route) bounds the total request size, but @IsObject keeps non-
  // object types (`null`, primitives, arrays) from being persisted as
  // command payloads — those have caused crashes in the bridge dispatcher.
  @ApiProperty()
  @IsObject()
  payload!: Record<string, unknown>;

  // Priority is a 16-bit-ish integer in practice (0 = default, 10 =
  // urgent, 100 = paging). Cap so a hostile admin can't store
  // 2^53 in the DB and break sort ORDER BY.
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  // Idempotency from the client. If absent, server generates one — but the
  // client SHOULD supply one when retrying.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class AckCommandDto {
  @ApiProperty({ enum: ["done", "failed"] as any })
  @IsIn(["done", "failed"] as any)
  status!: "done" | "failed";

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  result?: Record<string, unknown>;

  // Error reasons get persisted to `device_commands.error`. Cap so a
  // misbehaving (or malicious) device can't stuff multi-MB stack traces
  // into the DB on every failed ack.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  error?: string;
}
