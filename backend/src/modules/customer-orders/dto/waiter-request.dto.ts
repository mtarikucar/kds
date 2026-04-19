import { IsString, IsOptional, Length, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWaiterRequestDto {
  @ApiPropertyOptional({ description: 'Table ID; optional for tableless (counter) orders' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  tableId?: string;

  @ApiProperty()
  @IsString()
  @Length(32, 128)
  sessionId: string;

  @ApiPropertyOptional({ example: 'We need extra plates' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  message?: string;
}

export class CreateBillRequestDto {
  @ApiPropertyOptional({ description: 'Table ID; optional for tableless (counter) orders' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  tableId?: string;

  @ApiProperty()
  @IsString()
  @Length(32, 128)
  sessionId: string;
}
