import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";
import { NormalizePhone } from "../../../common/dto/normalize-phone";
import { EmptyStringToUndefined } from "../../../common/dto/transforms";
import { E164_PATTERN } from "../../../common/phone/e164.const";

/**
 * Post-social-login (and any incomplete-profile) onboarding. Phone is the one
 * hard requirement — without it PayTR checkout fails — and is normalized to
 * E.164 exactly like RegisterDto / CheckoutBuyerDto. Everything else is
 * collected-if-provided: name, business name, address, tax info, timezone,
 * language. Saved atomically across User + Tenant + the Main branch.
 */
export class CompleteProfileDto {
  @ApiProperty({ example: "+905551234567", maxLength: 32 })
  @NormalizePhone()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(E164_PATTERN, {
    message: "Lütfen geçerli bir telefon numarası girin.",
  })
  phone: string;

  @ApiProperty({ required: false })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  firstName?: string;

  @ApiProperty({ required: false })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @ApiProperty({ required: false, description: "İşletme / restoran adı" })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(120)
  businessName?: string;

  @ApiProperty({ required: false, description: "Vergi No / TC Kimlik" })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(20)
  taxId?: string;

  @ApiProperty({ required: false, description: "Vergi Dairesi" })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(120)
  taxOffice?: string;

  @ApiProperty({ required: false, description: "Açık adres" })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(300)
  addressLine?: string;

  @ApiProperty({ required: false })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  city?: string;

  @ApiProperty({ required: false, example: "Europe/Istanbul" })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(64)
  timezone?: string;

  @ApiProperty({ required: false, example: "tr" })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(10)
  locale?: string;
}
