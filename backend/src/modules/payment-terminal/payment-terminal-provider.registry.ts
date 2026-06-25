import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PaymentTerminalProvider } from "./payment-terminal-provider.interface";

/**
 * Registry of card-payment-terminal providers — mirrors FiscalProviderRegistry.
 * Adapters self-register in PaymentTerminalModule.onModuleInit.
 */
@Injectable()
export class PaymentTerminalProviderRegistry {
  private readonly logger = new Logger(PaymentTerminalProviderRegistry.name);
  private readonly providers = new Map<string, PaymentTerminalProvider>();

  register(provider: PaymentTerminalProvider): void {
    this.providers.set(provider.id, provider);
    this.logger.log(`Registered PaymentTerminalProvider: ${provider.id}`);
  }

  get(id: string): PaymentTerminalProvider {
    const p = this.providers.get(id);
    if (!p) {
      throw new NotFoundException(`Unknown payment-terminal provider: ${id}`);
    }
    return p;
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): PaymentTerminalProvider[] {
    return [...this.providers.values()];
  }
}
