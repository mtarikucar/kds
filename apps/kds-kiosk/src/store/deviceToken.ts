import { invoke } from '@tauri-apps/api/core';

/**
 * Device token persistence — backed by the Tauri-side keyring command.
 *
 * The keyring isn't accessible from web JS directly, so we call a Rust
 * command that wraps `keyring::Entry`. Falls back to localStorage in dev
 * mode when running outside Tauri (e.g. plain Vite preview) so the UI is
 * still usable without keyring access.
 */

export interface DeviceToken {
  deviceId: string;
  tenantId: string;
  branchId: string | null;
  token: string;
  expiresAt: string;
  apiUrl: string;
}

const LS_KEY = 'hummytummy_kds_token';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function loadDeviceToken(): Promise<DeviceToken | null> {
  if (isTauri()) {
    try {
      const raw = await invoke<string | null>('load_device_token');
      return raw ? (JSON.parse(raw) as DeviceToken) : null;
    } catch {
      return null;
    }
  }
  const raw = localStorage.getItem(LS_KEY);
  return raw ? (JSON.parse(raw) as DeviceToken) : null;
}

export async function saveDeviceToken(token: DeviceToken | null): Promise<void> {
  if (isTauri()) {
    await invoke('save_device_token', { value: token ? JSON.stringify(token) : null });
    return;
  }
  if (token) localStorage.setItem(LS_KEY, JSON.stringify(token));
  else localStorage.removeItem(LS_KEY);
}
