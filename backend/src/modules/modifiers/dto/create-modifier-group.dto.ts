import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export enum SelectionType {
  SINGLE = "SINGLE",
  MULTIPLE = "MULTIPLE",
}

export class CreateModifierGroupDto {
  // Caps mirror catalog (iter-48): identifiers small, display strings
  // generous, descriptions paragraph-sized. Without caps an admin or a
  // bug-driven write could persist a 100KB blob — Modifier.description
  // is Postgres TEXT, no implicit ceiling.
  @ApiProperty({ example: "sauces" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: "Soslar" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  displayName: string;

  @ApiProperty({
    example: "Ürününüze eklemek istediğiniz sosları seçin",
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: SelectionType, default: SelectionType.SINGLE })
  @IsEnum(SelectionType)
  @IsOptional()
  selectionType?: SelectionType;

  // 50 is comfortably above any realistic menu shape and well under the
  // OrderItemModifier flood any single line could produce.
  @ApiProperty({ example: 0, default: 0 })
  @IsInt()
  @Min(0)
  @Max(50)
  @IsOptional()
  minSelections?: number;

  @ApiProperty({ example: 3, required: false })
  @IsInt()
  @Min(1)
  @Max(50)
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
