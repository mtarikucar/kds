import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

// The reader types the UID like a keyboard: digits, letters, and whatever
// separator the vendor chose (colon, dot, hyphen, space). Anything else is not
// a card. Every field is declared because ValidationPipe runs with
// whitelist:true and silently strips what it does not know.
const CARD_UID_PATTERN = /^[0-9A-Za-z\s:.\-]{4,64}$/;

export class CardTapDto {
  @ApiProperty({ example: "04:A2:2B:9C" })
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  @Matches(CARD_UID_PATTERN, {
    message: "cardUid contains unsupported characters",
  })
  cardUid: string;

  // Same cap as ClockInDto.notes.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class AssignCardDto {
  @ApiProperty({ example: "04:A2:2B:9C" })
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  @Matches(CARD_UID_PATTERN, {
    message: "cardUid contains unsupported characters",
  })
  cardUid: string;
}
