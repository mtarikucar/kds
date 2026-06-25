import { ApiProperty } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export class RegisterTerminalDto {
  @ApiProperty({ example: "gmp3_card" })
  @IsString()
  providerId: string;

  @ApiProperty({ example: "OKC-00123" })
  @IsString()
  @MaxLength(120)
  serial: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  model?: string;

  /** Optional link to a paired device-mesh Device (required for bridge providers). */
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  deviceId?: string;

  /** Provider-specific config (vendorProfile, station code, …). May carry creds. */
  @ApiProperty({ required: false })
  @IsObject()
  @IsOptional()
  config?: Record<string, unknown>;
}
