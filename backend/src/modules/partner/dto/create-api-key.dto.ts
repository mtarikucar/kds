import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
} from "class-validator";
import { PARTNER_SCOPES, PartnerScope } from "../partner.constants";

export class CreateApiKeyDto {
  @ApiProperty({ description: "Human label for the key", maxLength: 80 })
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiPropertyOptional({
    description: "Scopes granted to the key (defaults to all)",
    enum: PARTNER_SCOPES,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PARTNER_SCOPES as unknown as string[], { each: true })
  scopes?: PartnerScope[];

  @ApiPropertyOptional({
    description: "Allowed PayTR self-pay return origins (https URLs)",
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsUrl({ protocols: ["https"], require_protocol: true }, { each: true })
  allowedReturnOrigins?: string[];

  @ApiPropertyOptional({
    description: "Restrict the key to specific branch ids (empty = all)",
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  allowedBranchIds?: string[];
}
