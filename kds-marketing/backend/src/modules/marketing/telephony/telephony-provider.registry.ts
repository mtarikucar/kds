import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TelephonyProvider } from './telephony-provider.interface';

/**
 * Registry of installed TelephonyProvider implementations. SalesCallService
 * looks a provider up by `id` and dispatches. Adapters self-register at module
 * init (see NetgsmLiteAdapter) — mirrors payments-core's PaymentProviderRegistry.
 */
@Injectable()
export class TelephonyProviderRegistry {
  private readonly logger = new Logger(TelephonyProviderRegistry.name);
  private readonly providers = new Map<string, TelephonyProvider>();

  register(provider: TelephonyProvider): void {
    if (this.providers.has(provider.id)) {
      this.logger.warn(`TelephonyProvider ${provider.id} re-registered`);
    }
    this.providers.set(provider.id, provider);
    this.logger.log(
      `Registered TelephonyProvider: ${provider.id} (maxConcurrent=${provider.maxConcurrentCalls}, caps=${provider.capabilities.join(',')})`,
    );
  }

  get(id: string): TelephonyProvider {
    const p = this.providers.get(id);
    if (!p) throw new NotFoundException(`Unknown telephony provider: ${id}`);
    return p;
  }

  list(): TelephonyProvider[] {
    return [...this.providers.values()];
  }
}
