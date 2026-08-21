import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsString } from "class-validator";
import { COUNTRY_PROFILES } from "../../../common/country/country-profile.const";

/**
 * Superadmin correction for a mis-registered tenant's country.
 *
 * Existing tenants are all Turkish today, which is correct — but a
 * mis-registration (wrong operator choice at signup) must be fixable
 * without a database console. Validated against the real COUNTRY_PROFILES
 * keys, same rule as RegisterDto#countryCode: a code with no profile would
 * silently resolve to DEFAULT_COUNTRY downstream and mislead the operator
 * into thinking the correction took effect.
 */
export class UpdateTenantCountryDto {
  @ApiProperty({
    enum: Object.keys(COUNTRY_PROFILES),
    example: "UZ",
    description:
      "ISO-3166-1 alpha-2 country to move the tenant to. Must be one of the platform's supported countries (COUNTRY_PROFILES).",
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(Object.keys(COUNTRY_PROFILES))
  countryCode: string;
}
