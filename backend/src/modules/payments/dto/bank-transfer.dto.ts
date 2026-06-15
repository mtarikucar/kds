import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { BillingCycle } from "../../../common/constants/subscription.enum";
import { EmptyStringToUndefined } from "../../../common/dto/transforms";

/** Tenant: create a manual bank-transfer (havale) intent for a plan. */
export class CreateBankTransferIntentDto {
  @ApiProperty()
  @IsUUID()
  planId: string;

  @ApiProperty({ enum: BillingCycle })
  @IsEnum(BillingCycle)
  billingCycle: BillingCycle;

  @ApiProperty({ type: [String], description: "Accepted legal document ids" })
  @IsArray()
  @IsUUID("all", { each: true })
  acceptedDocumentIds: string[];
}

/** Superadmin: edit the platform bank account shown to paying tenants. */
export class UpdateBankTransferSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountHolder?: string;

  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  iban?: string;

  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;
}

/** Superadmin: reject a pending transfer. */
export class RejectBankTransferDto {
  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
