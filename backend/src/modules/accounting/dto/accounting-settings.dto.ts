import {
  IsBoolean,
  IsOptional,
  IsString,
  IsInt,
  Matches,
  Min,
  IsIn,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  EmptyStringToNumber,
  EmptyStringToUndefined,
  StringToBoolean,
} from "../../../common/dto/transforms";

export class UpdateAccountingSettingsDto {
  @ApiPropertyOptional()
  @StringToBoolean()
  @IsBoolean()
  @IsOptional()
  autoGenerateInvoice?: boolean;

  @ApiPropertyOptional() @IsString() @IsOptional() companyName?: string;
  // A7: same VKN/TCKN shape rule as CreateSalesInvoiceDto.customerTaxId — a
  // malformed seller tax id would ride the sellerTaxId snapshot into every
  // issued document and only surface as a GİB rejection after sync.
  // EmptyStringToUndefined lets a form clear the field ("" → skip validation).
  @ApiPropertyOptional({
    description: "TR VKN (10 digits) or TCKN (11 digits)",
  })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @Matches(/^\d{10}(\d)?$/, {
    message: "companyTaxId must be 10 (VKN) or 11 (TCKN) digits",
  })
  companyTaxId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() companyTaxOffice?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() companyAddress?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() companyPhone?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() companyEmail?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @IsIn(["NONE", "PARASUT", "LOGO", "FORIBA"])
  provider?: string;
  @ApiPropertyOptional()
  @StringToBoolean()
  @IsBoolean()
  @IsOptional()
  autoSync?: boolean;

  @ApiPropertyOptional() @IsString() @IsOptional() parasutCompanyId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() parasutClientId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() parasutClientSecret?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() parasutUsername?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() parasutPassword?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() logoApiUrl?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() logoUsername?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() logoPassword?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() logoFirmNumber?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() foribaApiUrl?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() foribaUsername?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() foribaPassword?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() foribaServiceType?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() invoicePrefix?: string;
  @ApiPropertyOptional()
  @EmptyStringToNumber()
  @IsInt()
  @Min(1)
  @IsOptional()
  nextInvoiceNumber?: number;
  @ApiPropertyOptional()
  @EmptyStringToNumber()
  @IsInt()
  @Min(0)
  @IsOptional()
  defaultPaymentTermDays?: number;
}
