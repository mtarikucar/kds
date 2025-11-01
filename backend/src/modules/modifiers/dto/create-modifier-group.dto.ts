import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum SelectionType {
  SINGLE = 'SINGLE',
  MULTIPLE = 'MULTIPLE',
}

export class CreateModifierGroupDto {
  @ApiProperty({ example: 'sauces' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Soslar' })
  @IsString()
  @IsNotEmpty()
  displayName: string;

  @ApiProperty({ example: 'Ürününüze eklemek istediğiniz sosları seçin', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: SelectionType, default: SelectionType.SINGLE })
  @IsEnum(SelectionType)
  @IsOptional()
  selectionType?: SelectionType;

  @ApiProperty({ example: 0, default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  minSelections?: number;

  @ApiProperty({ example: 3, required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxSelections?: number;

  @ApiProperty({ example: false, default: false })
  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;

  @ApiProperty({ example: 0, default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;

  @ApiProperty({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
