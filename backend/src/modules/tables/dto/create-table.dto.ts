import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, IsEnum } from 'class-validator';

export enum TableStatus {
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  RESERVED = 'RESERVED',
}

export class CreateTableDto {
  @ApiProperty({ example: '1' })
  @IsString()
  @IsNotEmpty()
  number: string;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  capacity: number;

  @ApiProperty({ example: 'Main Hall', required: false })
  @IsString()
  @IsOptional()
  section?: string;

  @ApiProperty({ enum: TableStatus, example: TableStatus.AVAILABLE, default: TableStatus.AVAILABLE })
  @IsEnum(TableStatus)
  @IsOptional()
  status?: TableStatus;
}
