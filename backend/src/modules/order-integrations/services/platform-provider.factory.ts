import { Injectable, BadRequestException } from '@nestjs/common';
import { PlatformType } from '../constants';
import { IPlatformProvider } from '../interfaces';
import { TrendyolProvider } from './providers/trendyol.provider';
import { YemeksepetiProvider } from './providers/yemeksepeti.provider';
import { GetirProvider } from './providers/getir.provider';
import { MigrosProvider } from './providers/migros.provider';
import { FuudyProvider } from './providers/fuudy.provider';

/**
 * Factory for creating and managing platform providers
 * Follows the Factory Pattern to handle multiple delivery platforms
 */
@Injectable()
export class PlatformProviderFactory {
  constructor(
    private readonly trendyolProvider: TrendyolProvider,
    private readonly yemeksepetiProvider: YemeksepetiProvider,
    private readonly getirProvider: GetirProvider,
    private readonly migrosProvider: MigrosProvider,
    private readonly fuudyProvider: FuudyProvider,
  ) {}

  /**
   * Get a specific provider by platform type
   */
  getProvider(platformType: PlatformType): IPlatformProvider {
    switch (platformType) {
      case PlatformType.TRENDYOL:
        return this.trendyolProvider;
      case PlatformType.YEMEKSEPETI:
        return this.yemeksepetiProvider;
      case PlatformType.GETIR:
        return this.getirProvider;
      case PlatformType.MIGROS:
        return this.migrosProvider;
      case PlatformType.FUUDY:
        return this.fuudyProvider;
      default:
        throw new BadRequestException(`Unknown platform type: ${platformType}`);
    }
  }

  /**
   * Get all available providers
   */
  getAllProviders(): IPlatformProvider[] {
    return [
      this.trendyolProvider,
      this.yemeksepetiProvider,
      this.getirProvider,
      this.migrosProvider,
      this.fuudyProvider,
    ];
  }

  /**
   * Get all configured providers for a tenant
   */
  async getConfiguredProviders(tenantId: string): Promise<IPlatformProvider[]> {
    const allProviders = this.getAllProviders();
    const configuredProviders: IPlatformProvider[] = [];

    for (const provider of allProviders) {
      provider.setTenantContext(tenantId);
      if (await provider.isConfigured()) {
        configuredProviders.push(provider);
      }
    }

    return configuredProviders;
  }

  /**
   * Get a provider initialized for a specific tenant
   */
  async getProviderForTenant(
    platformType: PlatformType,
    tenantId: string,
  ): Promise<IPlatformProvider> {
    const provider = this.getProvider(platformType);
    await provider.initialize(tenantId);
    return provider;
  }

  /**
   * Get all provider types
   */
  getAllPlatformTypes(): PlatformType[] {
    return Object.values(PlatformType);
  }
}
