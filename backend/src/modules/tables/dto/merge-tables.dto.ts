import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MergeTablesDto {
  @ApiProperty({ description: 'IDs of tables to merge', type: [String], minItems: 2 })
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(2)
  tableIds: string[];
}

export class UnmergeTableDto {
  @ApiProperty({ description: 'ID of the table to remove from group' })
  @IsUUID()
  tableId: string;
}
