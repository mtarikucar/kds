import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from "class-validator";
import { DeliveryPlatform } from "../constants/platform.enum";

export class CreatePlatformConfigDto {
  @ApiProperty({ enum: DeliveryPlatform })
  @IsEnum(DeliveryPlatform)
  platform: DeliveryPlatform;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  credentials?: Record<string, any>;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  remoteRestaurantId?: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  autoAccept?: boolean;

  // Optional branch that receives this platform's orders. Omit/null to keep
  // the legacy "first active branch" fallback.
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({
    enum: ["production", "sandbox"],
    default: "production",
  })
  @IsOptional()
  @IsIn(["production", "sandbox"])
  environment?: "production" | "sandbox";
}
