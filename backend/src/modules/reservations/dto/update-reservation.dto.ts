import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsInt, IsOptional, IsDateString, Min, Max, IsEmail, Matches } from 'class-validator';

export class UpdateReservationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, { message: 'Start time must be in HH:mm format' })
  startTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, { message: 'End time must be in HH:mm format' })
  endTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  guestCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  adminNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tableId?: string;
}

export class RejectReservationDto {
  @ApiPropertyOptional({ description: 'Reason for rejection' })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
