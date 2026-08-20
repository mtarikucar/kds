import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  DeliveryPlatform,
  PLATFORM_AVAILABILITY,
  isPlatformAvailable,
} from "../constants/platform.enum";
import { PlatformAdapter } from "../interfaces/platform-adapter.interface";
import { GetirAdapter } from "./getir.adapter";
import { MigrosAdapter } from "./migros.adapter";
import { TrendyolAdapter } from "./trendyol.adapter";
import { YemeksepetiAdapter } from "./yemeksepeti.adapter";

@Injectable()
export class AdapterFactory {
  constructor(
    private readonly getirAdapter: GetirAdapter,
    private readonly yemeksepetiAdapter: YemeksepetiAdapter,
    private readonly trendyolAdapter: TrendyolAdapter,
    private readonly migrosAdapter: MigrosAdapter,
  ) {}

  getAdapter(platform: string): PlatformAdapter {
    // Single choke point for all 11 call sites (schedulers, webhook
    // controller, config/menu/order/moderation/test services). A platform we
    // have declared but not built yet answers 503, not 500 — and NOT the
    // `default:` Error below, which stays reserved for values we never heard
    // of. The `in` narrowing is load-bearing: isPlatformAvailable("DOORDASH")
    // is also false, and an unconditional gate would turn every typo into a
    // "coming soon" lie.
    if (platform in PLATFORM_AVAILABILITY && !isPlatformAvailable(platform)) {
      throw new ServiceUnavailableException(
        `Delivery platform ${platform} is not available yet`,
      );
    }
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
