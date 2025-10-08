import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { TableStatus } from './create-table.dto';

export class UpdateTableStatusDto {
  @ApiProperty({ enum: TableStatus, example: TableStatus.OCCUPIED })
  @IsEnum(TableStatus)
  @IsNotEmpty()
  status: TableStatus;
}
