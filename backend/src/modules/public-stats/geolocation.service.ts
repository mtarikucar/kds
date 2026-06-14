import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { numericEnv } from "../../common/config/numeric-env.util";
import axios from "axios";
import { maskIp } from "../../common/helpers/pii-mask.helper";

export interface GeoData {
  country: string;
  countryCode: string;
  region: string;
  city: string;
  latitude?: number;
  longitude?: number;
}

@Injectable()
export class GeolocationService {
  private readonly logger = new Logger(GeolocationService.name);
  private readonly cache = new Map<
    string,
    { data: GeoData | null; timestamp: number }
  >();
  // 24 hours by default; override via GEOLOCATION_CACHE_TTL_MS.
  private readonly CACHE_TTL: number;
  // v2.8.97 — cap. Pre-fix the Map grew without bound: a tenant with
  // high-traffic public-stats endpoints (campaign landing page) could
  // pile up tens of thousands of entries per day before the periodic
  // cleanCache() ticks. At 50K entries (~ a few MB) we evict the
  // oldest-inserted entries (Map preserves insertion order) so RSS
  // stays bounded.
  private static readonly MAX_CACHE_SIZE = 50_000;

  constructor(private readonly config?: ConfigService) {
    this.CACHE_TTL = numericEnv(
      this.config?.get("GEOLOCATION_CACHE_TTL_MS"),
      24 * 60 * 60 * 1000,
    );
  }

  private isLocalIp(ip: string): boolean {
    return (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "localhost" ||
      ip.startsWith("192.168.") ||
      ip.startsWith("10.") ||
      ip.startsWith("172.16.") ||
      ip.startsWith("172.17.") ||
      ip.startsWith("172.18.") ||
      ip.startsWith("172.19.") ||
      ip.startsWith("172.20.") ||
      ip.startsWith("172.21.") ||
      ip.startsWith("172.22.") ||
      ip.startsWith("172.23.") ||
      ip.startsWith("172.24.") ||
      ip.startsWith("172.25.") ||
      ip.startsWith("172.26.") ||
      ip.startsWith("172.27.") ||
      ip.startsWith("172.28.") ||
      ip.startsWith("172.29.") ||
      ip.startsWith("172.30.") ||
      ip.startsWith("172.31.")
    );
  }

  async lookup(ip: string): Promise<GeoData | null> {
    // Skip localhost/internal IPs
    if (this.isLocalIp(ip)) {
      return null;
    }

    // Check cache
    const cached = this.cache.get(ip);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      // Use ip-api.com (free tier: 45 requests/minute). HTTPS so an
      // on-path attacker can't inject a fake country/city — the free tier
      // serves HTTPS too, just without the `X-Rl` request-budget header.
      const response = await axios.get(
        `https://ip-api.com/json/${ip}?fields=status,country,countryCode,region,city,lat,lon`,
        { timeout: 3000 },
      );

      if (response.data.status === "success") {
        const geoData: GeoData = {
          country: response.data.country,
          countryCode: response.data.countryCode,
          region: response.data.region,
          city: response.data.city,
          latitude: response.data.lat,
          longitude: response.data.lon,
        };

        // Cache the result
        this.setCacheEntry(ip, { data: geoData, timestamp: Date.now() });

        return geoData;
      }
    } catch (error) {
      this.logger.warn(
        `Geolocation lookup failed for ${maskIp(ip)}: ${error.message}`,
      );
    }

    // Cache failed lookups too to avoid repeated failures
    this.setCacheEntry(ip, { data: null, timestamp: Date.now() });
    return null;
  }

  private setCacheEntry(
    ip: string,
    entry: { data: GeoData | null; timestamp: number },
  ): void {
    if (this.cache.has(ip)) this.cache.delete(ip);
    this.cache.set(ip, entry);
    while (this.cache.size > GeolocationService.MAX_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }

  // Clean old cache entries periodically
  cleanCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }
}
