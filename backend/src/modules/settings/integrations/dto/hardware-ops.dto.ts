import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

/**
 * iter-66 — three new DTO classes replacing inline `@Body() body: { ... }`
 * shapes on IntegrationsController.toggleStatus and HardwareConfigController's
 * /devices/:id/status + /devices/:id/events endpoints.
 *
 * The load-bearing case is UpdateDeviceStatusDto. The route is
 * accessible to WAITER and KITCHEN roles (legitimate use: thermal
 * printer pings home with its last paper-status), and the service
 * merges the body straight into `config.device_status` on the
 * integration row. With no DTO a malicious low-trust user could
 * persist arbitrary multi-MB blobs into that column, bloating the
 * row and the downstream getHardwareConfig response every staff
 * device fetches on connect.
 *
 * The DTO can't size-cap a nested JSONB tree directly through class-
 * validator, but @IsObject() at least gates the shape (rejects
 * strings, arrays, null) and a global JSON body-parser limit (set
 * elsewhere) provides the bandwidth ceiling. Combined that closes
 * the "WAITER posts 10MB-blob" amplification vector at validation
 * time.
 */

export class ToggleIntegrationStatusDto {
  @ApiProperty({ description: "New enabled state" })
  @IsBoolean()
  isEnabled: boolean;
}

export class UpdateDeviceStatusDto {
  @ApiProperty({
    description: "Hardware status snapshot merged into config.device_status",
  })
  @IsObject()
  // The service stores this as `device_status` on the integration row;
  // @IsObject() rejects strings / arrays / null at validation time so a
  // bug-driven or hostile client can't smuggle a primitive past the
  // controller and into the JSONB column.
  status: Record<string, unknown>;
}

export class ReportDeviceEventDto {
  @ApiProperty({ description: 'Event type (e.g. "printer.connected")' })
  @IsString()
  @MaxLength(120)
  event: string;

  @ApiPropertyOptional({ description: "Optional event payload" })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
