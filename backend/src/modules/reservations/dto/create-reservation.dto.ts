import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsInt, IsOptional, IsDateString, Min, Max, IsEmail } from 'class-validator';

export class CreateReservationDto {
  @ApiProperty({ description: 'Reservation date', example: '2026-03-01' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Start time', example: '19:00' })
  @IsString()
  startTime: string;

  @ApiProperty({ description: 'End time', example: '20:30' })
  @IsString()
  endTime: string;

  @ApiProperty({ description: 'Number of guests', example: 4 })
  @IsInt()
  @Min(1)
  @Max(100)
  guestCount: number;

  @ApiProperty({ description: 'Customer name', example: 'John Doe' })
  @IsString()
  customerName: string;

  @ApiProperty({ description: 'Customer phone', example: '+905551234567' })
  @IsString()
  customerPhone: string;

  @ApiPropertyOptional({ description: 'Customer email' })
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Table ID' })
  @IsOptional()
  @IsString()
  tableId?: string;
}
