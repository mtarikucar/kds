import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

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
  private readonly cache = new Map<string, { data: GeoData | null; timestamp: number }>();
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  private isLocalIp(ip: string): boolean {
    return (
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip === 'localhost' ||
      ip.startsWith('192.168.') ||
      ip.startsWith('10.') ||
      ip.startsWith('172.16.') ||
      ip.startsWith('172.17.') ||
      ip.startsWith('172.18.') ||
      ip.startsWith('172.19.') ||
      ip.startsWith('172.20.') ||
      ip.startsWith('172.21.') ||
      ip.startsWith('172.22.') ||
      ip.startsWith('172.23.') ||
      ip.startsWith('172.24.') ||
      ip.startsWith('172.25.') ||
      ip.startsWith('172.26.') ||
      ip.startsWith('172.27.') ||
      ip.startsWith('172.28.') ||
      ip.startsWith('172.29.') ||
      ip.startsWith('172.30.') ||
      ip.startsWith('172.31.')
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
      // Use ip-api.com (free tier: 45 requests/minute)
      const response = await axios.get(
        `http://ip-api.com/json/${ip}?fields=status,country,countryCode,region,city,lat,lon`,
        { timeout: 3000 }
      );

      if (response.data.status === 'success') {
        const geoData: GeoData = {
          country: response.data.country,
          countryCode: response.data.countryCode,
          region: response.data.region,
          city: response.data.city,
          latitude: response.data.lat,
          longitude: response.data.lon,
        };

        // Cache the result
        this.cache.set(ip, { data: geoData, timestamp: Date.now() });

        return geoData;
      }
    } catch (error) {
      this.logger.warn(`Geolocation lookup failed for ${ip}: ${error.message}`);
    }

    // Cache failed lookups too to avoid repeated failures
    this.cache.set(ip, { data: null, timestamp: Date.now() });
    return null;
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
