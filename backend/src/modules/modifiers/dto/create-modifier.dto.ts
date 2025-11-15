import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNumber,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateModifierDto {
  @ApiProperty({ example: 'extra_cheese' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Ekstra Peynir' })
  @IsString()
  @IsNotEmpty()
  displayName: string;

  @ApiProperty({ example: '+50gr kaşar peyniri', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 25.00, default: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  priceAdjustment?: number;

  @ApiProperty({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  isAvailable?: boolean;

  @ApiProperty({ example: 0, default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;

  @ApiProperty({ example: 'uuid-of-modifier-group' })
  @IsString()
  @IsNotEmpty()
  groupId: string;
}
