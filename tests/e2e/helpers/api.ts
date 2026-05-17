import { APIRequestContext, request } from '@playwright/test';
import * as speakeasy from 'speakeasy';
import { DEMO_USERS, DemoRole, PLATFORM_USERS } from '../fixtures/demo-users';

// Trailing slash matters: relative `auth/login` resolves to
// `http://localhost:50080/api/auth/login`. Without the trailing slash
// the path segment `/api` would be dropped on resolution.
export const API_BASE = process.env.API_BASE || 'http://localhost:50080/api/';

/**
 * Login over the API and return an APIRequestContext with the JWT
 * preset on `Authorization`. Useful for fast test-data setup that
 * shouldn't go through the UI.
 */
export async function loginAsApi(role: DemoRole): Promise<{
  api: APIRequestContext;
  accessToken: string;
  user: { id: string; tenantId: string; email: string; role: string };
}> {
  const creds = DEMO_USERS[role];
  const ctx = await request.newContext({ baseURL: API_BASE });
  const res = await ctx.post('auth/login', { data: { email: creds.email, password: creds.password } });
  if (!res.ok()) {
    throw new Error(`API login failed for ${role}: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  const accessToken: string = body.accessToken;
  await ctx.dispose();

  const api = await request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
  });
  return { api, accessToken, user: body.user };
}

/** Convenience: GET and return parsed JSON; throws on non-2xx. */
export async function getJson<T = unknown>(api: APIRequestContext, path: string): Promise<T> {
  const res = await api.get(path);
  if (!res.ok()) throw new Error(`GET ${path} → ${res.status()} ${await res.text()}`);
  return res.json() as Promise<T>;
}

/**
 * SuperAdmin login = 2-step (password → tempToken → TOTP verify).
 * Returns an APIRequestContext pre-armed with the final access token
 * for hitting `/superadmin/*` routes.
 */
export async function loginAsSuperAdmin(): Promise<{
  api: APIRequestContext;
  accessToken: string;
  user: { id: string; email: string };
}> {
  const { email, password, totpSecret } = PLATFORM_USERS.superadmin;
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const loginRes = await ctx.post('superadmin/auth/login', { data: { email, password } });
    if (!loginRes.ok())
      throw new Error(`superadmin login: ${loginRes.status()} ${await loginRes.text()}`);
    const { tempToken } = await loginRes.json();
    if (!tempToken) throw new Error('superadmin login: no tempToken in response');

    // Step 2: TOTP verify. Generate the current 30-second code from
    // the seeded secret using the same algorithm the backend's
    // speakeasy.verifyTotp call expects (SHA1, 6 digits, 30s step).
    const code = speakeasy.totp({ secret: totpSecret, encoding: 'base32' });
    const verifyRes = await ctx.post('superadmin/auth/verify-2fa', {
      data: { tempToken, code },
    });
    if (!verifyRes.ok())
      throw new Error(`superadmin verify-2fa: ${verifyRes.status()} ${await verifyRes.text()}`);
    const body = await verifyRes.json();
    const accessToken: string = body.accessToken;
    const user = body.superAdmin ?? body.user ?? { id: '', email };
    await ctx.dispose();

    const api = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
    });
    return { api, accessToken, user };
  } catch (e) {
    await ctx.dispose();
    throw e;
  }
}

export async function loginAsMarketing(): Promise<{
  api: APIRequestContext;
  accessToken: string;
  user: { id: string; email: string; role: string };
}> {
  const { email, password } = PLATFORM_USERS.marketing;
  const ctx = await request.newContext({ baseURL: API_BASE });
  const res = await ctx.post('marketing/auth/login', { data: { email, password } });
  if (!res.ok())
    throw new Error(`marketing login: ${res.status()} ${await res.text()}`);
  const body = await res.json();
  const accessToken: string = body.accessToken;
  await ctx.dispose();

  const api = await request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
  });
  return { api, accessToken, user: body.user };
}
