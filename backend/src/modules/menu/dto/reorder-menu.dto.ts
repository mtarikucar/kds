import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsString,
} from "class-validator";

/**
 * Batch reorder payload shared by PATCH /menu/categories/reorder and
 * PATCH /menu/products/reorder. The server applies displayOrder = array
 * index inside ONE transaction, replacing the old per-row PATCH fan-out
 * that could leave a half-applied order on partial failure.
 */
export class ReorderMenuDto {
  @ApiProperty({
    example: ["b6a4…", "0f21…"],
    type: [String],
    description:
      "Ids in their new display order — displayOrder becomes the array index",
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  orderedIds: string[];
}
