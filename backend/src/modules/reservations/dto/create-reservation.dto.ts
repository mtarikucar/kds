import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsInt,
  IsOptional,
  IsDateString,
  Min,
  Max,
  IsEmail,
  Matches,
  MaxLength,
} from 'class-validator';

// E.164-ish: optional +, 8-15 digits. Accepts typical restaurant phones and
// rejects obvious junk / oversized bodies.
const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

export class CreateReservationDto {
  @ApiProperty({ description: 'Reservation date', example: '2026-03-01' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Start time', example: '19:00' })
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, { message: 'Start time must be in HH:mm format' })
  startTime: string;

  @ApiProperty({ description: 'End time', example: '20:30' })
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, { message: 'End time must be in HH:mm format' })
  endTime: string;

  @ApiProperty({ description: 'Number of guests', example: 4 })
  @IsInt()
  @Min(1)
  @Max(100)
  guestCount: number;

  @ApiProperty({ description: 'Customer name', example: 'John Doe' })
  @IsString()
  @MaxLength(100)
  customerName: string;

  @ApiProperty({ description: 'Customer phone (E.164 or digits)', example: '+905551234567' })
  @IsString()
  @MaxLength(20)
  @Matches(PHONE_REGEX, {
    message: 'customerPhone must be a valid phone number (8-15 digits, optional leading +)',
  })
  customerPhone: string;

  @ApiPropertyOptional({ description: 'Customer email' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  customerEmail?: string;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: 'Table ID' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tableId?: string;
}

export class CancelPublicReservationDto {
  @ApiProperty({ description: 'Customer phone used at booking time' })
  @IsString()
  @MaxLength(20)
  @Matches(PHONE_REGEX, {
    message: 'customerPhone must be a valid phone number (8-15 digits, optional leading +)',
  })
  customerPhone: string;

  @ApiProperty({ description: 'Reservation number issued at booking time' })
  @IsString()
  @MaxLength(32)
  reservationNumber: string;
}
