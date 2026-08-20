import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { SmsProvider } from "./sms-provider.interface";

/**
 * Registry of installed SmsProvider implementations, keyed by `name`
 * ("netgsm" | "twilio" today). Mirrors PaymentProviderRegistry /
 * FiscalProviderRegistry / EscPosBuilderRegistry: each concrete adapter
 * registers itself in its own onModuleInit() — conditional on having real
 * credentials, see NetGsmProvider/TwilioProvider — so SmsService resolves a
 * provider by id rather than constructing a vendor class directly.
 *
 * Task 11 (SMS: process-once -> per-tenant). Before this, SmsService picked
 * ONE provider at construction time from a single process-wide SMS_PROVIDER
 * env var, so a single deployment could never route Turkish tenants to
 * NetGSM and other-country tenants to a different provider. This registry
 * is the seam that makes per-tenant selection possible — see
 * CountryCapabilityResolver.smsProviderIdFor() for the id a given tenant
 * should look up here.
 */
@Injectable()
export class SmsProviderRegistry {
  private readonly logger = new Logger(SmsProviderRegistry.name);
  private readonly providers = new Map<string, SmsProvider>();

  register(provider: SmsProvider): void {
    if (this.providers.has(provider.name)) {
      this.logger.warn(`SmsProvider ${provider.name} re-registered`);
    }
    this.providers.set(provider.name, provider);
    this.logger.log(`Registered SmsProvider: ${provider.name}`);
  }

  get(id: string): SmsProvider {
    const p = this.providers.get(id);
    if (!p) throw new NotFoundException(`Unknown SMS provider: ${id}`);
    return p;
  }

  list(): SmsProvider[] {
    return [...this.providers.values()];
  }
}
