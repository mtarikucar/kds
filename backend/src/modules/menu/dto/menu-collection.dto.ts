import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from "class-validator";

// A menu collection is a classification independent of Category ("Kampanyalar",
// "Menüler", "Yeni"). A product can belong to several; the QR menu renders each
// as a strip. See spec §3/§9.
export class CreateMenuCollectionDto {
  @ApiProperty({ example: "Kampanyalar" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({
    example: "kampanyalar",
    description: "URL-safe slug; auto-derived from name when omitted.",
  })
  @IsString()
  @IsOptional()
  @MaxLength(80)
  @Matches(/^[a-z0-9-]+$/, {
    message: "slug yalnızca küçük harf, rakam ve tire içerebilir",
  })
  slug?: string;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateMenuCollectionDto extends PartialType(
  CreateMenuCollectionDto,
) {}
