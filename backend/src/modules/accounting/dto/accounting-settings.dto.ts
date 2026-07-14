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
  @IsIn(["NONE", "PARASUT", "LOGO", "FORIBA", "NILVERA"])
  provider?: string;
  @ApiPropertyOptional()
  @StringToBoolean()
  @IsBoolean()
  @IsOptional()
  autoSync?: boolean;

  // SECRET fields carry @EmptyStringToUndefined: "" means "unchanged", never
  // "clear". The FE already skips empty secrets, but any non-UI client
  // (Swagger try-it-out, ops script round-tripping the settings object) would
  // otherwise silently overwrite the stored encrypted credential with "" —
  // and sanitize() never returns it, so it would be unrecoverable.
  @ApiPropertyOptional() @IsString() @IsOptional() parasutCompanyId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() parasutClientId?: string;
  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  parasutClientSecret?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() parasutUsername?: string;
  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  parasutPassword?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() logoApiUrl?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() logoUsername?: string;
  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  logoPassword?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() logoFirmNumber?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() foribaApiUrl?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() foribaUsername?: string;
  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  foribaPassword?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() foribaServiceType?: string;

  // Nilvera: statik "Persisted Access Token" modeli — kullanıcı adı/şifre yok,
  // panelden üretilen API anahtarı + tenant'ın panelinden teyit edilen apiUrl.
  // apiUrl https-zorunlu ve nilvera.com host'una kilitli: baseURL her isteğe
  // Bearer anahtar + fatura içeriği taşır — serbest bir URL, anahtar
  // sızdırma/SSRF hedefi olurdu. Bilinçli olarak EmptyStringToUndefined YOK:
  // "" gönderimi sessiz silme yerine net bir 400 doğrulama hatası üretir
  // (URL'siz Nilvera zaten çalışamaz; sağlayıcıyı kapatmak için provider=NONE).
  @ApiPropertyOptional({
    description: "Nilvera API host (https, *.nilvera.com)",
  })
  @IsString()
  @IsOptional()
  @Matches(/^https:\/\/([a-z0-9-]+\.)*nilvera\.com(\/|$)/i, {
    message: "nilveraApiUrl must be an https URL on the nilvera.com domain",
  })
  nilveraApiUrl?: string;
  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  nilveraApiKey?: string;

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
