import { IsString, IsNotEmpty, IsArray, IsInt, Min, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignModifierGroupDto {
  @ApiProperty({ example: 'uuid-of-modifier-group' })
  @IsString()
  @IsNotEmpty()
  groupId: string;

  @ApiProperty({ example: 0, default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;
}

export class AssignModifiersToProductDto {
  @ApiProperty({ type: [AssignModifierGroupDto] })
  @IsArray()
  modifierGroups: AssignModifierGroupDto[];
}
