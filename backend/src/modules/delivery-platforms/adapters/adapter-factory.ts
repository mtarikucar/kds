import { Injectable } from '@nestjs/common';
import { DeliveryPlatform } from '../constants/platform.enum';
import { PlatformAdapter } from '../interfaces/platform-adapter.interface';
import { GetirAdapter } from './getir.adapter';
import { MigrosAdapter } from './migros.adapter';
import { TrendyolAdapter } from './trendyol.adapter';
import { YemeksepetiAdapter } from './yemeksepeti.adapter';

@Injectable()
export class AdapterFactory {
  constructor(
    private readonly getirAdapter: GetirAdapter,
    private readonly yemeksepetiAdapter: YemeksepetiAdapter,
    private readonly trendyolAdapter: TrendyolAdapter,
    private readonly migrosAdapter: MigrosAdapter,
  ) {}

  getAdapter(platform: string): PlatformAdapter {
    switch (platform) {
      case DeliveryPlatform.GETIR:
        return this.getirAdapter;
      case DeliveryPlatform.YEMEKSEPETI:
        return this.yemeksepetiAdapter;
      case DeliveryPlatform.TRENDYOL:
        return this.trendyolAdapter;
      case DeliveryPlatform.MIGROS:
        return this.migrosAdapter;
      default:
        throw new Error(`Unknown delivery platform: ${platform}`);
    }
  }
}
