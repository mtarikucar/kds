import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
} from "class-validator";
import { PARTNER_SCOPES, PartnerScope } from "../partner.constants";

export class MintScreenSessionDto {
  @ApiProperty({ description: "Branch the screen is bound to" })
  @IsUUID()
  branchId: string;

  @ApiPropertyOptional({
    description: "Table the screen is bound to (optional)",
  })
  @IsOptional()
  @IsUUID()
  tableId?: string;

  @ApiPropertyOptional({
    description:
      "Scopes for this screen (subset of the key's; defaults to all key scopes)",
    enum: PARTNER_SCOPES,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PARTNER_SCOPES as unknown as string[], { each: true })
  scopes?: PartnerScope[];
}
