import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransferTableOrdersDto {
  @ApiProperty({ description: 'Source table ID' })
  @IsString()
  @IsNotEmpty()
  sourceTableId: string;

  @ApiProperty({ description: 'Target table ID' })
  @IsString()
  @IsNotEmpty()
  targetTableId: string;

  @ApiPropertyOptional({
    description: 'Allow transfer to occupied table (merge orders)',
    default: true
  })
  @IsBoolean()
  @IsOptional()
  allowMerge?: boolean;
}
