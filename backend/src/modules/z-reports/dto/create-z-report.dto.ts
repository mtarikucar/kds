import { IsNotEmpty, IsNumber, IsString, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateZReportDto {
  @ApiProperty({ description: 'Date of the report (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsDateString()
  reportDate: string;

  @ApiProperty({ description: 'Cash drawer opening balance' })
  @IsNotEmpty()
  @IsNumber()
  cashDrawerOpening: number;

  @ApiProperty({ description: 'Cash drawer closing balance (counted)' })
  @IsNotEmpty()
  @IsNumber()
  cashDrawerClosing: number;

  @ApiProperty({ description: 'Optional notes for the report', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
