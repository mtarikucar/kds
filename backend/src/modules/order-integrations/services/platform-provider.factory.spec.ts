import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PlatformProviderFactory } from './platform-provider.factory';
import { TrendyolProvider } from './providers/trendyol.provider';
import { YemeksepetiProvider } from './providers/yemeksepeti.provider';
import { GetirProvider } from './providers/getir.provider';
import { MigrosProvider } from './providers/migros.provider';
import { FuudyProvider } from './providers/fuudy.provider';
import { PlatformType } from '../constants';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';

describe('PlatformProviderFactory', () => {
  let factory: PlatformProviderFactory;
  let trendyolProvider: DeepMockProxy<TrendyolProvider>;
  let yemeksepetiProvider: DeepMockProxy<YemeksepetiProvider>;
  let getirProvider: DeepMockProxy<GetirProvider>;
  let migrosProvider: DeepMockProxy<MigrosProvider>;
  let fuudyProvider: DeepMockProxy<FuudyProvider>;

  beforeEach(async () => {
    trendyolProvider = mockDeep<TrendyolProvider>();
    yemeksepetiProvider = mockDeep<YemeksepetiProvider>();
    getirProvider = mockDeep<GetirProvider>();
    migrosProvider = mockDeep<MigrosProvider>();
    fuudyProvider = mockDeep<FuudyProvider>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformProviderFactory,
        { provide: TrendyolProvider, useValue: trendyolProvider },
        { provide: YemeksepetiProvider, useValue: yemeksepetiProvider },
        { provide: GetirProvider, useValue: getirProvider },
        { provide: MigrosProvider, useValue: migrosProvider },
        { provide: FuudyProvider, useValue: fuudyProvider },
      ],
    }).compile();

    factory = module.get<PlatformProviderFactory>(PlatformProviderFactory);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getProvider', () => {
    it('should return TrendyolProvider for TRENDYOL', () => {
      const provider = factory.getProvider(PlatformType.TRENDYOL);
      expect(provider).toBe(trendyolProvider);
    });

    it('should return YemeksepetiProvider for YEMEKSEPETI', () => {
      const provider = factory.getProvider(PlatformType.YEMEKSEPETI);
      expect(provider).toBe(yemeksepetiProvider);
    });

    it('should return GetirProvider for GETIR', () => {
      const provider = factory.getProvider(PlatformType.GETIR);
      expect(provider).toBe(getirProvider);
    });

    it('should return MigrosProvider for MIGROS', () => {
      const provider = factory.getProvider(PlatformType.MIGROS);
      expect(provider).toBe(migrosProvider);
    });

    it('should return FuudyProvider for FUUDY', () => {
      const provider = factory.getProvider(PlatformType.FUUDY);
      expect(provider).toBe(fuudyProvider);
    });

    it('should throw BadRequestException for unknown type', () => {
      expect(() => factory.getProvider('UNKNOWN' as PlatformType)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('getAllProviders', () => {
    it('should return all 5 providers', () => {
      const providers = factory.getAllProviders();

      expect(providers).toHaveLength(5);
      expect(providers).toContain(trendyolProvider);
      expect(providers).toContain(yemeksepetiProvider);
      expect(providers).toContain(getirProvider);
      expect(providers).toContain(migrosProvider);
      expect(providers).toContain(fuudyProvider);
    });
  });

  describe('getConfiguredProviders', () => {
    it('should return only configured providers for tenant', async () => {
      trendyolProvider.isConfigured.mockResolvedValue(true);
      yemeksepetiProvider.isConfigured.mockResolvedValue(false);
      getirProvider.isConfigured.mockResolvedValue(true);
      migrosProvider.isConfigured.mockResolvedValue(false);
      fuudyProvider.isConfigured.mockResolvedValue(false);

      const providers = await factory.getConfiguredProviders('tenant-1');

      expect(providers).toHaveLength(2);
      expect(providers).toContain(trendyolProvider);
      expect(providers).toContain(getirProvider);
    });

    it('should set tenant context for each provider', async () => {
      trendyolProvider.isConfigured.mockResolvedValue(false);
      yemeksepetiProvider.isConfigured.mockResolvedValue(false);
      getirProvider.isConfigured.mockResolvedValue(false);
      migrosProvider.isConfigured.mockResolvedValue(false);
      fuudyProvider.isConfigured.mockResolvedValue(false);

      await factory.getConfiguredProviders('tenant-1');

      expect(trendyolProvider.setTenantContext).toHaveBeenCalledWith('tenant-1');
      expect(yemeksepetiProvider.setTenantContext).toHaveBeenCalledWith('tenant-1');
      expect(getirProvider.setTenantContext).toHaveBeenCalledWith('tenant-1');
      expect(migrosProvider.setTenantContext).toHaveBeenCalledWith('tenant-1');
      expect(fuudyProvider.setTenantContext).toHaveBeenCalledWith('tenant-1');
    });

    it('should return empty array when no providers configured', async () => {
      trendyolProvider.isConfigured.mockResolvedValue(false);
      yemeksepetiProvider.isConfigured.mockResolvedValue(false);
      getirProvider.isConfigured.mockResolvedValue(false);
      migrosProvider.isConfigured.mockResolvedValue(false);
      fuudyProvider.isConfigured.mockResolvedValue(false);

      const providers = await factory.getConfiguredProviders('tenant-1');

      expect(providers).toHaveLength(0);
    });
  });

  describe('getProviderForTenant', () => {
    it('should return initialized provider for tenant', async () => {
      getirProvider.initialize.mockResolvedValue(undefined);

      const provider = await factory.getProviderForTenant(
        PlatformType.GETIR,
        'tenant-1',
      );

      expect(provider).toBe(getirProvider);
      expect(getirProvider.initialize).toHaveBeenCalledWith('tenant-1');
    });

    it('should throw for unknown platform type', async () => {
      await expect(
        factory.getProviderForTenant('UNKNOWN' as PlatformType, 'tenant-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAllPlatformTypes', () => {
    it('should return all platform types', () => {
      const types = factory.getAllPlatformTypes();

      expect(types).toContain(PlatformType.TRENDYOL);
      expect(types).toContain(PlatformType.YEMEKSEPETI);
      expect(types).toContain(PlatformType.GETIR);
      expect(types).toContain(PlatformType.MIGROS);
      expect(types).toContain(PlatformType.FUUDY);
      expect(types).toHaveLength(5);
    });
  });
});
