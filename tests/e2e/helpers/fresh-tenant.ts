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
 * Trial-related specs need this because the seeded demo tenant is already
 * on BUSINESS, has its trial state pre-stamped, and is shared across
 * matrix tests — flipping its trial fields would break dozens of
 * unrelated assertions. A throwaway tenant minted per test keeps the
 * trial-lifecycle scenarios isolated.
 *
 * AuthService.register auto-attaches a 14-day BUSINESS trial on every
 * new restaurant, so the returned tenant is on TRIALING BUSINESS unless
 * the test explicitly downgrades it.
 */
export async function registerFreshTenant(
  label = 'trial',
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
    // empty user_phone). Stamp a Turkish-format placeholder so trial
    // tests can drive create-intent without a separate UI detour.
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
