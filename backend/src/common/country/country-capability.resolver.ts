import { Injectable } from "@nestjs/common";
import { CountryService } from "./country.service";
import { PrismaService } from "../../prisma/prisma.service";
import { PaymentProviderRegistry } from "../../modules/payments-core/payment-provider.registry";
import { PaymentProvider } from "../../modules/payments-core/payment-provider.interface";
import { FiscalProviderRegistry } from "../../modules/fiscal-core/fiscal-provider.registry";
import { FiscalProvider } from "../../modules/fiscal-core/fiscal-provider.interface";
import { EscPosBuilderRegistry } from "../../modules/device-mesh/printing/escpos-builder.registry";
import { EscPosBuilder } from "../../modules/device-mesh/printing/escpos.types";

/**
 * Turns "this tenant's country" into "this provider instance": looks up the
 * id the country profile names in the registry that owns it.
 *
 * This is Phase 2 (CAPABILITY) of the multi-country architecture. Phase 1
 * (Tasks 1-8) made every per-country PARAMETER available on the country
 * profile; this resolver is the one place that turns the profile's provider
 * IDS into actual, DI-resolved provider INSTANCES — so callers stop writing
 * "paytr" / "fiscal_hugin" / "escpos-tr" literals and instead ask "give me
 * the provider for this tenant."
 *
 * Nothing calls this yet (Task 9 only builds the seam) — Tasks 10-13 rewire
 * the existing call sites onto it. Until then this is dead code reachable
 * only from tests, and a Turkish tenant's behaviour is unchanged.
 *
 * TWO RULES THIS CLASS EXISTS TO ENFORCE:
 *
 * 1. A profile capability that is `null` or `[]` is an EXPLICIT REFUSAL, not
 *    a signal to fall back to the Turkish provider. Uzbekistan has no fiscal
 *    or payment adapter yet; silently handing a UZ tenant the PayTR/Hugin
 *    instance would be a compliance incident (a UZ café cannot legally issue
 *    a Turkish fiscal receipt), so every resolution method throws a clear,
 *    actionable error instead.
 *
 * 2. Fiscal is a SET, not a single id. `fiscalProviderIds` names every
 *    LEGAL fiscal adapter for the country (Turkey alone has four); which one
 *    a given restaurant physically owns is a TENANT fact, recorded on
 *    `FiscalDeviceRecord.providerId` when the operator registers their ÖKC
 *    (see FiscalService.registerDevice). `fiscalProviderFor` therefore reads
 *    the tenant's own configured device and VALIDATES it against the
 *    country's legal set — it never picks a device for the tenant.
 *
 * A profile naming an id that no registry actually has (a typo, or a
 * provider that was removed) must fail loudly HERE, at resolution time —
 * never as the registry's own bare 404 surfacing deep inside a payment or a
 * receipt. See country-capability.resolver.spec.ts's real-DI test, which
 * walks every profile against the live registries and would have caught the
 * four wrong ids Task 1's review found ("generic", "hugin", "nilvera",
 * "eskiz").
 */
@Injectable()
export class CountryCapabilityResolver {
  constructor(
    private readonly country: CountryService,
    private readonly paymentRegistry: PaymentProviderRegistry,
    private readonly fiscalRegistry: FiscalProviderRegistry,
    private readonly escposRegistry: EscPosBuilderRegistry,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The tenant's payment provider, in the country's preference order. Today
   * every country names at most one id, so "first" and "only" coincide;
   * preference order exists for the day a country has more than one.
   */
  async paymentProviderFor(tenantId: string): Promise<PaymentProvider> {
    const profile = await this.country.forTenant(tenantId);
    const [id] = profile.capabilities.paymentProviderIds;
    if (!id) {
      throw new Error(
        `No payment provider configured for ${profile.code} — the country ` +
          `profile lists none yet. A ${profile.code} tenant cannot be charged ` +
          `through a provider that does not exist for their country.`,
      );
    }
    return this.resolveOrThrow(
      this.paymentRegistry,
      id,
      "payment",
      profile.code,
    );
  }

  /** The ESC/POS byte-builder for the tenant's country. */
  async escposBuilderFor(tenantId: string): Promise<EscPosBuilder> {
    const profile = await this.country.forTenant(tenantId);
    return this.resolveOrThrow(
      this.escposRegistry,
      profile.capabilities.escposBuilderId,
      "ESC/POS builder",
      profile.code,
    );
  }

  /** The SMS_PROVIDER value sms.service.ts checks, for the tenant's country. */
  async smsProviderIdFor(tenantId: string): Promise<string> {
    const profile = await this.country.forTenant(tenantId);
    const id = profile.capabilities.smsProviderId;
    if (!id) {
      throw new Error(
        `No SMS provider configured for ${profile.code} — the country ` +
          `profile lists none yet.`,
      );
    }
    return id;
  }

  /**
   * The tenant's fiscal provider — see rule 2 above. Resolves the tenant's
   * own configured, non-retired FiscalDeviceRecord and validates its
   * providerId against the country's legal set. Distinct failure for
   * "the country has no legal fiscal set" vs "this tenant has not
   * configured a device yet" vs "this device's provider is not legal here"
   * vs "the profile names a provider nothing has registered" — each is a
   * different operator action, so each gets its own message.
   */
  async fiscalProviderFor(tenantId: string): Promise<FiscalProvider> {
    const profile = await this.country.forTenant(tenantId);
    if (profile.capabilities.fiscalProviderIds.length === 0) {
      throw new Error(
        `No fiscal provider configured for ${profile.code} — the country ` +
          `profile lists none yet. A ${profile.code} tenant cannot issue a ` +
          `fiscal receipt through a jurisdiction with no legal provider.`,
      );
    }

    const device = await this.prisma.fiscalDeviceRecord.findFirst({
      where: { tenantId, status: { not: "retired" } },
      orderBy: { createdAt: "asc" },
    });
    if (!device) {
      throw new Error(
        `Tenant ${tenantId} has no fiscal device configured — register one ` +
          `before issuing receipts.`,
      );
    }
    if (!profile.capabilities.fiscalProviderIds.includes(device.providerId)) {
      throw new Error(
        `Fiscal provider '${device.providerId}' (tenant ${tenantId}'s ` +
          `configured device) is not legal in ${profile.code}. Allowed: ` +
          `${profile.capabilities.fiscalProviderIds.join(", ") || "none"}.`,
      );
    }
    return this.resolveOrThrow(
      this.fiscalRegistry,
      device.providerId,
      "fiscal",
      profile.code,
    );
  }

  /**
   * Every registry throws its own NotFoundException (a 404) for an unknown
   * id — correct for "a caller asked for a made-up id at runtime", wrong for
   * "the country profile itself names an id nothing implements". The latter
   * is a configuration bug, not a 404, and must not be allowed to surface as
   * one deep inside a payment or a receipt — so it is caught and rethrown as
   * a plain, loudly-worded Error naming the country, the capability kind,
   * and the bad id.
   */
  private resolveOrThrow<T>(
    registry: { get(id: string): T },
    id: string,
    kind: string,
    countryCode: string,
  ): T {
    try {
      return registry.get(id);
    } catch {
      throw new Error(
        `${countryCode} country profile names ${kind} provider '${id}', but ` +
          `no such provider is registered. This is a configuration error in ` +
          `country-profile.const.ts, not a tenant issue — check it against ` +
          `the registered adapter ids.`,
      );
    }
  }
}
