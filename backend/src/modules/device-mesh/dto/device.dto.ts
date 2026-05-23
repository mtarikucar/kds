import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const KINDS = [
  'tablet_waiter',
  'tablet_customer',
  'kds_screen',
  'bar_screen',
  'pos_terminal',
  'yazarkasa',
  'receipt_printer',
  'kitchen_printer',
  'caller_id',
  'scanner',
  'local_bridge',
] as const;

export class CreateDeviceSlotDto {
  @ApiProperty({ enum: KINDS })
  @IsIn(KINDS as any)
  kind!: (typeof KINDS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serial?: string;

  @ApiPropertyOptional({ default: 'byo' })
  @IsOptional()
  @IsIn(['sold', 'rented', 'byo'] as any)
  ownership?: 'sold' | 'rented' | 'byo';
}

export class PairDeviceDto {
  // 6-character alphanumeric pair code shown to the operator. Keeping it
  // short and uppercase reduces typo rate; the random space is large
  // enough for a 10-minute TTL (36^6 = 2.2B).
  @ApiProperty({ example: 'A4F9K2' })
  @IsString()
  @Length(6, 6)
  @Matches(/^[A-Z0-9]+$/)
  pairCode!: string;

  // Optional client metadata that surfaces in the admin device-detail view.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serial?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];
}

export class HeartbeatDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  batteryPct?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ip?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agentVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  queueDepth?: number;
}

export class EnqueueCommandDto {
  @ApiProperty()
  @IsString()
  kind!: string;

  @ApiProperty()
  payload!: Record<string, unknown>;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  priority?: number;

  // Idempotency from the client. If absent, server generates one — but the
  // client SHOULD supply one when retrying.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class AckCommandDto {
  @ApiProperty({ enum: ['done', 'failed'] as any })
  @IsIn(['done', 'failed'] as any)
  status!: 'done' | 'failed';

  @ApiPropertyOptional()
  @IsOptional()
  result?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  error?: string;
}
