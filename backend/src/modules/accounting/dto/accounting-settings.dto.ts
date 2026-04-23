import { IsBoolean, IsOptional, IsString, IsInt, Min, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EmptyStringToNumber, StringToBoolean } from '../../../common/dto/transforms';

export class UpdateAccountingSettingsDto {
  @ApiPropertyOptional() @StringToBoolean() @IsBoolean() @IsOptional() autoGenerateInvoice?: boolean;

  @ApiPropertyOptional() @IsString() @IsOptional() companyName?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() companyTaxId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() companyTaxOffice?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() companyAddress?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() companyPhone?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() companyEmail?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @IsIn(['NONE', 'PARASUT', 'LOGO', 'FORIBA']) provider?: string;
  @ApiPropertyOptional() @StringToBoolean() @IsBoolean() @IsOptional() autoSync?: boolean;

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
  @ApiPropertyOptional() @EmptyStringToNumber() @IsInt() @Min(1) @IsOptional() nextInvoiceNumber?: number;
  @ApiPropertyOptional() @EmptyStringToNumber() @IsInt() @Min(0) @IsOptional() defaultPaymentTermDays?: number;
}
