import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from "class-validator";
import {
  AVAILABLE_DELIVERY_PLATFORMS,
  DeliveryPlatform,
} from "../constants/platform.enum";

export class CreatePlatformConfigDto {
  // @IsIn, not @IsEnum: the enum now carries coming-soon platforms too, and
  // POST /delivery-platforms/configs must answer 400 for those so a config row
  // can never exist without an adapter behind it.
  @ApiProperty({ enum: AVAILABLE_DELIVERY_PLATFORMS })
  @IsIn(AVAILABLE_DELIVERY_PLATFORMS as readonly string[])
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
