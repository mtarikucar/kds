import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class ParseMenuSourceDto {
  /**
   * The link to import from. Optional because the same endpoint also accepts
   * a directly-uploaded file; the service rejects a request carrying neither.
   */
  @ApiProperty({ required: false, example: "https://restoran.com/menu" })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;
}
