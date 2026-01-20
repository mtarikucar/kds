/**
 * Subdomain Detection Utility
 *
 * Detects if the current request is coming from a restaurant subdomain
 * and extracts the subdomain for API calls.
 *
 * Examples:
 * - demo.hummytummy.com -> subdomain: "demo"
 * - demo.staging.hummytummy.com -> subdomain: "demo"
 * - hummytummy.com -> no subdomain
 * - staging.hummytummy.com -> no subdomain
 * - localhost -> no subdomain
 */

export interface SubdomainInfo {
  subdomain: string | null;
  isSubdomainAccess: boolean;
}

// Reserved subdomains that should not be treated as restaurant subdomains
const RESERVED_SUBDOMAINS = ['www', 'app', 'api', 'admin', 'staging', 'mail', 'smtp', 'ftp'];

export function detectSubdomain(): SubdomainInfo {
  const hostname = window.location.hostname;
  const parts = hostname.split('.');

  // Local development - no subdomain detection
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.includes('localhost')) {
    return { subdomain: null, isSubdomainAccess: false };
  }

  const isStaging = parts.includes('staging');

  // Staging environment: {restaurant}.staging.hummytummy.com = 4 parts
  // Example: demo.staging.hummytummy.com
  if (isStaging && parts.length === 4) {
    const potentialSubdomain = parts[0].toLowerCase();
    if (!RESERVED_SUBDOMAINS.includes(potentialSubdomain)) {
      return { subdomain: potentialSubdomain, isSubdomainAccess: true };
    }
  }

  // Production environment: {restaurant}.hummytummy.com = 3 parts
  // Example: demo.hummytummy.com
  if (!isStaging && parts.length === 3) {
    const potentialSubdomain = parts[0].toLowerCase();
    if (!RESERVED_SUBDOMAINS.includes(potentialSubdomain)) {
      return { subdomain: potentialSubdomain, isSubdomainAccess: true };
    }
  }

  return { subdomain: null, isSubdomainAccess: false };
}

/**
 * Builds navigation URLs based on whether we're in subdomain mode or not
 */
export function buildQRMenuUrl(
  page: 'menu' | 'cart' | 'orders' | 'loyalty',
  options: {
    subdomain?: string | null;
    tenantId?: string;
    tableId?: string | null;
    sessionId?: string | null;
  }
): string {
  const { subdomain, tenantId, tableId, sessionId } = options;

  // Subdomain access - use root paths
  if (subdomain) {
    const params = new URLSearchParams();
    if (tableId) params.set('tableId', tableId);
    if (sessionId && (page === 'orders' || page === 'loyalty')) {
      params.set('sessionId', sessionId);
    }
    const queryString = params.toString();

    switch (page) {
      case 'menu':
        return `/${queryString ? `?${queryString}` : ''}`;
      case 'cart':
        return `/cart${queryString ? `?${queryString}` : ''}`;
      case 'orders':
        return `/orders${queryString ? `?${queryString}` : ''}`;
      case 'loyalty':
        return `/loyalty${queryString ? `?${queryString}` : ''}`;
    }
  }

  // Path-based access - use /qr-menu/:tenantId paths
  if (tenantId) {
    const baseUrl = `/qr-menu/${tenantId}`;
    const params = new URLSearchParams();
    if (tableId) params.set('tableId', tableId);
    if (sessionId && (page === 'orders' || page === 'loyalty')) {
      params.set('sessionId', sessionId);
    }
    const queryString = params.toString();

    switch (page) {
      case 'menu':
        return `${baseUrl}${queryString ? `?${queryString}` : ''}`;
      case 'cart':
        return `${baseUrl}/cart${queryString ? `?${queryString}` : ''}`;
      case 'orders':
        return `${baseUrl}/orders${queryString ? `?${queryString}` : ''}`;
      case 'loyalty':
        return `${baseUrl}/loyalty${queryString ? `?${queryString}` : ''}`;
    }
  }

  return '/';
}
