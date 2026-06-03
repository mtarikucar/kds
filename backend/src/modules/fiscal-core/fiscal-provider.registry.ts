import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { FiscalProvider } from "./fiscal-provider.interface";

@Injectable()
export class FiscalProviderRegistry {
  private readonly logger = new Logger(FiscalProviderRegistry.name);
  private readonly providers = new Map<string, FiscalProvider>();

  register(provider: FiscalProvider): void {
    this.providers.set(provider.id, provider);
    this.logger.log(
      `Registered FiscalProvider: ${provider.id} (caps=${provider.capabilities.join(",")})`,
    );
  }

  get(id: string): FiscalProvider {
    const p = this.providers.get(id);
    if (!p) throw new NotFoundException(`Unknown fiscal provider: ${id}`);
    return p;
  }

  list(): FiscalProvider[] {
    return [...this.providers.values()];
  }
}
