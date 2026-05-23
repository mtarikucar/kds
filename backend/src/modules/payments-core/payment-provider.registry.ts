import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaymentProvider } from './payment-provider.interface';

/**
 * Registry of installed PaymentProvider implementations. The Payments façade
 * looks providers up here by `id` and dispatches the request.
 *
 * Each adapter registers itself via `register()` at module init — Nest's
 * lifecycle hooks plus the @Global OutboxModule give us enough plumbing
 * without bringing in an extra DI container.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly logger = new Logger(PaymentProviderRegistry.name);
  private readonly providers = new Map<string, PaymentProvider>();

  register(provider: PaymentProvider): void {
    if (this.providers.has(provider.id)) {
      this.logger.warn(`PaymentProvider ${provider.id} re-registered`);
    }
    this.providers.set(provider.id, provider);
    this.logger.log(`Registered PaymentProvider: ${provider.id} (modes=${provider.modes.join(',')})`);
  }

  get(id: string): PaymentProvider {
    const p = this.providers.get(id);
    if (!p) throw new NotFoundException(`Unknown payment provider: ${id}`);
    return p;
  }

  list(): PaymentProvider[] {
    return [...this.providers.values()];
  }
}
