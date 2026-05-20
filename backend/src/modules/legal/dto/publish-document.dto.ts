import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsEnum,
  Matches,
  IsOptional,
  IsDateString,
} from "class-validator";
import { LegalDocumentKind } from "../constants";

/**
 * Publish a new version of a legal document. SuperAdmin-only.
 *
 * Semantics:
 *   - Creates a new LegalDocument row with isCurrent=true.
 *   - In the same transaction, flips the previous `isCurrent=true` row
 *     of the same kind+locale to isCurrent=false.
 *   - Old rows are NEVER deleted because existing Consent rows
 *     reference them — that's how we preserve audit trail across
 *     version bumps.
 */
export class PublishLegalDocumentDto {
  @ApiProperty({ enum: LegalDocumentKind, description: "Document kind" })
  @IsEnum(LegalDocumentKind)
  kind!: LegalDocumentKind;

  @ApiProperty({
    description: 'Semver-ish version string, e.g. "1.1", "2.0"',
    example: "1.1",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+\.\d+(\.\d+)?$/, {
    message: "version must match MAJOR.MINOR[.PATCH]",
  })
  @MaxLength(20)
  version!: string;

  @ApiProperty({ description: "BCP-47 locale code", example: "tr" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  locale!: string;

  @ApiProperty({
    description: "Human-readable title displayed at top of the page",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: "Document body in Markdown" })
  @IsString()
  @IsNotEmpty()
  bodyMarkdown!: string;

  @ApiPropertyOptional({
    description:
      'When this version takes effect. Defaults to "now". Useful for scheduling pre-announced policy changes.',
  })
  @IsOptional()
  @IsDateString()
  effectiveAt?: string;
}
