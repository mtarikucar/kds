import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsObject,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * Body for POST /v1/installation. Previously the controller accepted an
 * inline TypeScript shape, which the global ValidationPipe cannot
 * validate — every field flowed through unchecked, so branchId /
 * hwOrderId could be non-UUID strings, preferredDates could be an
 * unbounded array of garbage, and notes could be a 100KB blob. iter-61
 * converts the body into a proper DTO class so ValidationPipe fires.
 */
export class CreateInstallationRequestDto {
  @ApiPropertyOptional({
    description: "Branch the install is for (defaults to tenant HQ)",
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: "Hardware order being fulfilled" })
  @IsOptional()
  @IsUUID()
  hwOrderId?: string;

  // 10 preferred dates is generous for "I have these slots free" — the
  // ops queue UI shows 3-5. Each date is validated as ISO-8601 so an
  // operator typing the wrong string at the DTO-less boundary couldn't
  // smuggle in arbitrary text that downstream date arithmetic would
  // silently coerce to Invalid Date.
  @ApiPropertyOptional({
    description: "Customer-preferred install dates (ISO-8601)",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsDateString({}, { each: true })
  preferredDates?: string[];

  @ApiPropertyOptional({ description: "Free-form note (audit trail)" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/**
 * Body for POST /v1/warranties/:id/claims. Same DTO-less story as
 * CreateInstallationRequestDto — iter-61 converts the inline body to a
 * validated class. Caps mirror the surrounding fulfillment DTOs.
 */
export class FileWarrantyClaimDto {
  @ApiProperty({
    description: "One-line description of the failure (required)",
  })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  issue: string;

  @ApiPropertyOptional({ enum: ["low", "medium", "high"], default: "medium" })
  @IsOptional()
  @IsIn(["low", "medium", "high"])
  severity?: "low" | "medium" | "high";

  @ApiPropertyOptional({ description: "Long-form context (audit trail)" })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;
}

/**
 * Body for POST /v1/superadmin/shipments/:orderId. Carrier strings are
 * ops-controlled today ("manual", "yurtici"…) but capped here so a
 * paste-the-wrong-thing typo can't seed a multi-MB row, and the meta
 * blob is forced to be a JSON object — the schema column is JSONB,
 * which Prisma would happily accept arrays / primitives / strings if
 * we don't gate them.
 */
export class CreateShipmentDto {
  @ApiProperty({ description: 'Carrier id (e.g. "manual", "yurtici", "aras")' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  carrier: string;

  @ApiPropertyOptional({ description: "Carrier-side tracking number" })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  trackingNo?: string;

  @ApiPropertyOptional({
    description: "Carrier-specific extras (label url, weight, etc.)",
  })
  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}

export class ScheduleInstallationDto {
  @ApiProperty({
    example: "2026-06-15T09:00:00.000Z",
    description: "ISO-8601 scheduled date/time",
  })
  @IsDateString({}, { message: "scheduledFor must be an ISO-8601 date string" })
  scheduledFor: string;

  // MinLength(1) so an explicit "" can't silently overwrite a previously-set
  // technician — to clear an assignment, the client should omit the field.
  @ApiProperty({ required: false, description: "Technician id / handle" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  assignedTo?: string;
}

export class CompleteInstallationDto {
  @ApiProperty({
    required: false,
    description: "Close-out note appended to the request",
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class CancelInstallationDto {
  @ApiProperty({
    required: false,
    description: "Cancellation reason (audit trail)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
