import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from "class-validator";

export class UpdatePlatformConfigDto {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  credentials?: Record<string, any>;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  remoteRestaurantId?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  autoAccept?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notifySound?: string;

  // Which branch receives this platform's orders. null clears the override
  // and restores the legacy "first active branch" fallback.
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  branchId?: string | null;

  // "production" routes to the live platform; "sandbox" routes the adapter to
  // the platform's test endpoints and enables the built-in test-order simulator.
  @ApiPropertyOptional({ enum: ["production", "sandbox"] })
  @IsOptional()
  @IsIn(["production", "sandbox"])
  environment?: "production" | "sandbox";
}
