/**
 * Reserved subdomains that cannot be used by tenants.
 * Keep in sync with any routing/ingress aliases on the platform.
 */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  'www',
  'app',
  'api',
  'admin',
  'staging',
  'mail',
  'smtp',
  'ftp',
  'status',
  'help',
  'support',
  'docs',
  'dashboard',
  'login',
  'signup',
  'register',
  'auth',
  'cdn',
  'static',
  'assets',
  'beta',
  'test',
  'demo',
];

/**
 * Validates subdomain format: 3-63 chars, lowercase letters/digits/hyphens,
 * no leading/trailing hyphen. Matches DNS label rules.
 */
export const SUBDOMAIN_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{1,2}$/;

/**
 * How long a released subdomain stays in the ReservedSubdomain table
 * before it can be reclaimed. 90 days blocks opportunistic takeover after
 * a tenant is suspended/deleted or changes their subdomain.
 */
export const SUBDOMAIN_QUARANTINE_DAYS = 90;
