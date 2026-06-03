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

  // 256KB cap. Real KVKK / mesafeli / iade documents land in the
  // 5-20KB range; this leaves an order of magnitude of headroom while
  // preventing a hijacked superadmin session from stuffing a 100MB
  // blob into the bodyMarkdown column (the body-parser limit was the
  // only previous bound).
  @ApiProperty({ description: "Document body in Markdown" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256 * 1024)
  bodyMarkdown!: string;

  @ApiPropertyOptional({
    description:
      'When this version takes effect. Defaults to "now". Stored on the row but informational only — getCurrent() returns whichever row has isCurrent=true regardless of effectiveAt. To pre-stage a future policy: publish with isCurrent=false off-band, or publish at the cutover moment.',
  })
  @IsOptional()
  @IsDateString()
  effectiveAt?: string;
}
