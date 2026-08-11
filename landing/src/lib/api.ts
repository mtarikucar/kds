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

// Fail loud if API URL is missing. The previous silent fallback to a
// hard-coded prod host (`api.hummytummy.com.tr`) was the same anti-pattern
// the frontend removed in commit 5154c2e — a staging/preview build with no
// NEXT_PUBLIC_API_URL would silently call production and either leak or
// scribble. In dev the localhost fallback is fine; in build/runtime prod
// we'd rather miss the value at config time than serve cross-env data.
const API_BASE = (() => {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[landing] NEXT_PUBLIC_API_URL is not set in production — refusing to use a hard-coded fallback. The catalog fetch will return empty and the pricing section renders the free core only.',
    );
    return '';
  }
  return 'http://localhost:3000';
})();

/**
 * The published à-la-carte catalog — the same rows checkout prices from.
 *
 * Replaces `getPlans()`. Plans were retired in v3.3.0: that endpoint now
 * returns an empty array forever, and the pricing section it fed was falling
 * back to hardcoded tier prices that no longer exist.
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

/**
 * Join the configured base with an API path exactly once.
 *
 * Prod builds pass NEXT_PUBLIC_API_URL=https://hummytummy.com/api — already
 * carrying the prefix — while a dev build points at http://localhost:3000,
 * which does not. The previous code appended `/api` unconditionally, so every
 * production fetch went to /api/api/... and 404'd. That failure was invisible:
 * the fetch swallowed it, returned [], and the pricing section fell back to
 * hardcoded tier prices, so the page looked right while showing numbers no
 * API had confirmed for months.
 */
function apiUrl(path: string): string {
  const root = API_BASE.replace(/\/+$/, '');
  return `${root}${root.endsWith('/api') ? '' : '/api'}${path}`;
}

export async function getCatalog(locale = 'tr'): Promise<CatalogProduct[]> {
  // Static generation with no API base configured renders the free core and a
  // contact CTA. A missing price is recoverable; a stale one is not.
  if (!API_BASE) return [];
  try {
    const res = await fetch(
      apiUrl(`/v1/catalog/pricing?locale=${encodeURIComponent(locale)}`),
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const body: { products: CatalogProduct[] } = await res.json();
    return (body.products ?? []).filter((p) => p.kind !== 'service');
  } catch {
    return [];
  }
}

