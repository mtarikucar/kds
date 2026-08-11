import stats from '@/data/stats.json';

export interface FormattedStats {
  restaurantCount: string;
  orderCount: string;
  totalRevenue: string;
}

// Static stats loaded at build time
export function getStats(): FormattedStats {
  return {
    restaurantCount: stats.restaurantCount,
    orderCount: stats.orderCount,
    totalRevenue: stats.totalRevenue,
  };
}

/**
 * Where to reach the API, most-reliable first.
 *
 * The catalog fetch runs on the SERVER (a server component), and from inside
 * the container a request to the public host has to leave the box, cross
 * Cloudflare and come back — which is a hairpin that can quietly fail while
 * the very same URL works from a browser. INTERNAL_API_URL points at the
 * backend service on the shared docker network and skips the round trip; the
 * public base stays as the fallback for build-time generation, where the
 * internal name does not resolve.
 *
 * No hard-coded production host: a staging or preview build with nothing set
 * would otherwise silently read production data. In dev, localhost.
 */
const API_BASES: string[] = [
  process.env.INTERNAL_API_URL,
  process.env.NEXT_PUBLIC_API_URL,
  process.env.API_URL,
  process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3000',
].filter((v): v is string => !!v);

/**
 * Join a base with an API path exactly once.
 *
 * Prod passes NEXT_PUBLIC_API_URL=https://hummytummy.com/api — already
 * carrying the prefix — while a dev base does not. Appending `/api`
 * unconditionally sent every production request to /api/api/... where it
 * 404'd, and the failure was invisible: the fetch swallowed it, returned [],
 * and the pricing section fell back to hardcoded tier prices. The page looked
 * right while showing numbers no API had confirmed in months.
 */
function apiUrl(base: string, path: string): string {
  const root = base.replace(/\/+$/, '');
  return `${root}${root.endsWith('/api') ? '' : '/api'}${path}`;
}

/**
 * The published à-la-carte catalog — the same rows checkout prices from.
 *
 * Replaces the retired plan list: that endpoint returns an empty array
 * forever, and the pricing section it fed was falling back to hardcoded tier
 * prices that no longer exist.
 */
export interface CatalogProduct {
  code: string;
  name: string;
  description: string | null;
  kind: 'license' | 'module' | 'integration' | 'capacity' | 'credit' | 'service';
  billing: 'annual' | 'oneTime';
  priceCents: number;
  currency: string;
  creditKind: string | null;
  creditUnits: number | null;
  requiresLicense: boolean;
  sortOrder: number;
}

export async function getCatalog(locale = 'tr'): Promise<CatalogProduct[]> {
  const path = `/v1/catalog/pricing?locale=${encodeURIComponent(locale)}`;
  for (const base of API_BASES) {
    try {
      const res = await fetch(apiUrl(base, path), { next: { revalidate: 300 } });
      if (!res.ok) continue;
      const body: { products: CatalogProduct[] } = await res.json();
      // Services are sold with hardware, not from the price list.
      return (body.products ?? []).filter((p) => p.kind !== 'service');
    } catch {
      // Try the next base. A price the page cannot verify is worse than none:
      // if every base fails the section renders the free core and says the
      // list is unavailable, instead of a remembered number.
    }
  }
  return [];
}

