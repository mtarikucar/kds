import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  COUNTRY_PROFILES,
  DEFAULT_COUNTRY,
  CountryProfile,
} from "./country-profile.const";
import { RequestContext } from "../context/request-context";

/**
 * The one door to a country profile. Nothing else may index COUNTRY_PROFILES
 * directly — that keeps the fallback behaviour and the logging in one place.
 */
@Injectable()
export class CountryService {
  private readonly logger = new Logger(CountryService.name);

  constructor(private readonly prisma: PrismaService) {}

  forCode(code: string | null | undefined): CountryProfile {
    const profile = code
      ? COUNTRY_PROFILES[code as keyof typeof COUNTRY_PROFILES]
      : undefined;
    if (!profile) {
      if (code) {
        this.logger.warn(
          `Unknown countryCode "${code}" — using ${DEFAULT_COUNTRY}`,
        );
      }
      return COUNTRY_PROFILES[DEFAULT_COUNTRY];
    }
    return profile;
  }

  async forTenant(tenantId: string): Promise<CountryProfile> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { countryCode: true },
    });
    return this.forCode(t?.countryCode);
  }

  /** Currency is DERIVED. Tenant.currency is a written mirror, never the truth. */
  async currencyForTenant(tenantId: string): Promise<string> {
    return (await this.forTenant(tenantId)).currency;
  }

  /**
   * The profile for the request in flight, resolved synchronously from the
   * ambient RequestContext. Outside a request (cron, bootstrap) this is the
   * default profile. Populated by Task 3.
   */
  ambient(): CountryProfile {
    return this.forCode(RequestContext.get()?.countryCode);
  }
}
