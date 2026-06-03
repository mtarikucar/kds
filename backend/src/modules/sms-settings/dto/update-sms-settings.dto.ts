import { IsBoolean, IsOptional } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateSmsSettingsDto {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  smsOnReservationCreated?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  smsOnReservationConfirmed?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  smsOnReservationRejected?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  smsOnReservationCancelled?: boolean;

  // Per-event email channel toggles. Read by ReservationNotification
  // Service to decide whether to route through email vs fall back to
  // SMS. Optional because the global ValidationPipe strips unknown
  // fields with whitelist:true — without these declarations a
  // backwards-compat admin payload would silently lose the bits.
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  emailOnReservationCreated?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  emailOnReservationConfirmed?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  emailOnReservationRejected?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  emailOnReservationCancelled?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  smsOnOrderCreated?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  smsOnOrderApproved?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  smsOnOrderPreparing?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  smsOnOrderReady?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  smsOnOrderCancelled?: boolean;
}
