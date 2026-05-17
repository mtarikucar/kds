import { APIRequestContext } from '@playwright/test';

/**
 * Patch the current tenant's POS settings. The endpoint accepts a
 * partial body and merges over the existing row (or auto-creates one
 * on first call). Returns the updated row so tests can assert on the
 * post-state directly.
 */
export async function setPosSettings(
  api: APIRequestContext,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await api.patch('pos-settings', { data: patch });
  if (!res.ok()) throw new Error(`setPosSettings failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function setQrMenuSettings(
  api: APIRequestContext,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await api.patch('qr/settings', { data: patch });
  if (!res.ok()) throw new Error(`setQrMenuSettings failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function setTenantSettings(
  api: APIRequestContext,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await api.patch('tenants/settings', { data: patch });
  if (!res.ok()) throw new Error(`setTenantSettings failed: ${res.status()} ${await res.text()}`);
  return res.json();
}
