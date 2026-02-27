import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsDateString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AssignShiftDto {
  @ApiProperty()
  @IsString()
  userId: string;

  @ApiProperty()
  @IsString()
  shiftTemplateId: string;

  @ApiProperty()
  @IsDateString()
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkAssignShiftDto {
  @ApiProperty({ type: [AssignShiftDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssignShiftDto)
  assignments: AssignShiftDto[];
}
