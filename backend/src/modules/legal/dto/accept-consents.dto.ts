import { ApiProperty } from "@nestjs/swagger";
import { ArrayMinSize, ArrayMaxSize, IsArray, IsUUID } from "class-validator";

/**
 * Body the frontend sends at checkout: the ids of the three legal
 * documents the user just checked in the checkbox group. The service
 * cross-references these against the current `isCurrent=true` rows for
 * KVKK / DISTANCE_SALES / REFUND_POLICY — eksik veya stale id = 400.
 */
export class AcceptConsentsDto {
  @ApiProperty({
    description:
      "Three LegalDocument ids the user accepted in the checkout form",
    type: [String],
    minItems: 3,
    maxItems: 3,
    example: ["uuid-kvkk", "uuid-distance-sales", "uuid-refund"],
  })
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsUUID(undefined, { each: true })
  acceptedDocumentIds!: string[];
}
