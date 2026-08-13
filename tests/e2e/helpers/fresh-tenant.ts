import { APIRequestContext, request } from '@playwright/test';
import { API_BASE } from './api';

export interface FreshTenantResult {
  /** Authenticated APIRequestContext, JWT pre-set on Authorization. */
  api: APIRequestContext;
  accessToken: string;
  user: { id: string; email: string; tenantId: string; role: string };
  /** The exact email + password used so callers can re-login via UI if needed. */
  email: string;
  password: string;
  restaurantName: string;
  subdomainHint: string;
}

const DEFAULT_PASSWORD = 'Passw0rd!';

/**
 * Register a brand-new tenant (and its ADMIN user) via the public
 * `POST /auth/register` endpoint and return an authed APIRequestContext.
 *
 * WHY A THROWAWAY TENANT
 *
 * The seeded Sultanahmet demo tenant is shared by the whole matrix suite, so
 * any spec that mutates tenant-wide state — entitlement overrides, owned
 * modules, licence dates, billing profile — would break dozens of unrelated
 * assertions and leave the shared fixture dirty when its own cleanup is
 * skipped (timeout, abort, retry). A tenant minted per spec keeps those
 * scenarios isolated.
 *
 * WHAT THE RETURNED TENANT ACTUALLY IS
 *
 * The free core, and nothing else. `POST /auth/register` creates a tenant, a
 * Main branch and an ADMIN user; it attaches no plan, no subscription row and
 * no trial countdown (see AuthProvisioningService.provisionNewTenantWithAdmin
 * — since the 2026-08-11 à-la-carte release it does not even look a plan up).
 *
 * The practical consequence for callers: paid capability is never present by
 * default. Each paid module is an individual annual product bought behind the
 * annual licence, so a spec that needs one must grant or purchase it
 * explicitly — do not assume the tenant arrives holding anything beyond
 * `FREE_BASELINE_GRANTS` (backend/src/modules/entitlements/free-baseline.const.ts).
 *
 * The header this replaced described the retired model as fact ("already on
 * BUSINESS", "auto-attaches a 14-day BUSINESS trial", "unless the test
 * explicitly downgrades it"), which would have sent the next reader looking
 * for tiers and trials that no longer exist anywhere in the product.
 */
export async function registerFreshTenant(
  label = 'fresh',
): Promise<FreshTenantResult> {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  const email = `e2e-${label}-${ts}-${rand}@example.com`;
  const restaurantName = `E2E ${label} ${ts}`;

  const pub = await request.newContext({ baseURL: API_BASE });
  try {
    const res = await pub.post('auth/register', {
      data: {
        email,
        password: DEFAULT_PASSWORD,
        firstName: 'E2E',
        lastName: 'Owner',
        restaurantName,
      },
    });
    if (!res.ok()) {
      throw new Error(`registerFreshTenant failed: ${res.status()} ${await res.text()}`);
    }
    const body = await res.json();
    const accessToken: string = body.accessToken;
    const user = body.user as FreshTenantResult['user'];
    if (!accessToken || !user) {
      throw new Error(
        `registerFreshTenant got an unexpected response shape: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }

    const api = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
    });

    // PaymentsService.createIntent throws PROFILE_PHONE_REQUIRED when
    // the calling user's phone is empty (PayTR's get-token rejects
    // empty user_phone). Stamp a Turkish-format placeholder so checkout
    // specs can drive create-intent without a separate UI detour.
    // Idempotent if profile-update fails — caller can still proceed
    // for tests that don't touch checkout.
    await api
      .patch('users/me/profile', {
        data: {
          firstName: 'E2E',
          lastName: 'Owner',
          phone: '+905551234567',
        },
      })
      .catch(() => undefined);

    return {
      api,
      accessToken,
      user,
      email,
      password: DEFAULT_PASSWORD,
      restaurantName,
      subdomainHint: restaurantName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    };
  } finally {
    await pub.dispose();
  }
}
