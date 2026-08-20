import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  COUNTRY_PROFILES,
  DEFAULT_COUNTRY,
  CountryProfile,
} from "./country-profile.const";
import { RequestContext } from "../context/request-context";

/**
 * Pure code → profile fallback, shared by CountryService.forCode() (which
 * adds the unknown-code warning log below) and the handful of call sites
 * that cannot reach the DI container: class-validator `registerDecorator`
 * validators run their `validate()` outside Nest's injector, and a couple of
 * plain parsing helpers (menu import) are called from inside a request but
 * are not themselves injectable. Both still need the tenant's ambient
 * country, so they read RequestContext directly and resolve through this —
 * never by indexing COUNTRY_PROFILES themselves — so there is exactly one
 * implementation of "what a code resolves to" in the whole codebase.
 */
export function resolveCountryProfile(
  code: string | null | undefined,
): CountryProfile {
  const profile = code
    ? COUNTRY_PROFILES[code as keyof typeof COUNTRY_PROFILES]
    : undefined;
  return profile ?? COUNTRY_PROFILES[DEFAULT_COUNTRY];
}

/**
 * The one door to a country profile. Nothing else may index COUNTRY_PROFILES
 * directly — that keeps the fallback behaviour and the logging in one place.
 */
@Injectable()
export class CountryService {
  private readonly logger = new Logger(CountryService.name);

  // Process-lifetime cache of resolved country codes, keyed by tenantId. A
  // tenant's country never changes in practice, so this misses exactly once
  // per tenant per process — see cachedCodeFor()/invalidate() below, which
  // exist so RequestContextInterceptor (a global APP_INTERCEPTOR on every
  // HTTP request) has a synchronous fast path instead of a query per request.
  private readonly codeCache = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  forCode(code: string | null | undefined): CountryProfile {
    // Delegates the actual fallback DECISION to resolveCountryProfile() —
    // this method's only remaining job is the warning log, decided by
    // comparing the input to what came back rather than re-indexing
    // COUNTRY_PROFILES itself (that would just be a second copy of the
    // same fallback this refactor exists to remove). Before this, forCode()
    // carried its own independent "known code ?? TR" ternary.
    const profile = resolveCountryProfile(code);
    if (code && profile.code !== code) {
      this.logger.warn(
        `Unknown countryCode "${code}" — using ${DEFAULT_COUNTRY}`,
      );
    }
    return profile;
  }

  async forTenant(tenantId: string): Promise<CountryProfile> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { countryCode: true },
    });
    const profile = this.forCode(t?.countryCode);
    this.codeCache.set(tenantId, profile.code);
    return profile;
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

  /**
   * Synchronous peek for the request hot path (RequestContextInterceptor).
   * Null means "not yet resolved this process" — the caller falls back to
   * the async forTenant() once, which populates the cache for every
   * subsequent request.
   */
  cachedCodeFor(tenantId: string): string | null {
    return this.codeCache.get(tenantId) ?? null;
  }

  /**
   * Called wherever Tenant.countryCode is written, so the cache cannot go
   * stale. Nothing does that today besides tenant creation (which always
   * writes the default), but a future superadmin edit must call this or a
   * tenant's country would be stuck at whatever the process first cached.
   */
  invalidate(tenantId: string): void {
    this.codeCache.delete(tenantId);
  }
}
