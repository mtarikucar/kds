import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { EmptyStringToNumber } from '../../../common/dto/transforms';

export class AssignModifierGroupDto {
  @ApiProperty({ example: 'uuid-of-modifier-group' })
  @IsString()
  @IsNotEmpty()
  groupId: string;

  @ApiProperty({ example: 0, default: 0 })
  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class AssignModifiersToProductDto {
  // @ValidateNested + @Type are required for class-validator to recurse into
  // the inner DTO. Without them the `@IsString() groupId` constraint above
  // is silently skipped on every array element.
  @ApiProperty({ type: [AssignModifierGroupDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AssignModifierGroupDto)
  modifierGroups: AssignModifierGroupDto[];
}
