import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

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
