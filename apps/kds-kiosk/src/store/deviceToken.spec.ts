import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadDeviceToken, saveDeviceToken, type DeviceToken } from './deviceToken';
import { invoke } from '@tauri-apps/api/core';

// Mock the Tauri core module so `invoke` is controllable from tests.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

const sample: DeviceToken = {
  deviceId: 'dev-1',
  tenantId: 'ten-1',
  branchId: null,
  token: 'secret-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  apiUrl: 'https://api.example.com/api',
};

const LS_KEY = 'hummytummy_kds_token';

// Minimal in-memory localStorage stub so the non-Tauri fallback path works
// under the `node` test environment (which has no DOM localStorage).
function installLocalStorage(): void {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  vi.stubGlobal('localStorage', ls);
}

function enterTauri(): void {
  // isTauri() checks for window.__TAURI_INTERNALS__.
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
}

function exitTauri(): void {
  // window present but without the internals marker -> not Tauri.
  vi.stubGlobal('window', {});
}

beforeEach(() => {
  invokeMock.mockReset();
  installLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deviceToken under Tauri', () => {
  beforeEach(() => enterTauri());

  it('loadDeviceToken invokes the keyring command and parses its JSON', async () => {
    invokeMock.mockResolvedValueOnce(JSON.stringify(sample));

    const result = await loadDeviceToken();

    expect(result).toEqual(sample);
    expect(invokeMock).toHaveBeenCalledWith('load_device_token');
  });

  it('loadDeviceToken returns null when the keyring is empty', async () => {
    invokeMock.mockResolvedValueOnce(null);
    expect(await loadDeviceToken()).toBeNull();
  });

  it('loadDeviceToken swallows a keyring error and returns null', async () => {
    invokeMock.mockRejectedValueOnce(new Error('keyring locked'));
    expect(await loadDeviceToken()).toBeNull();
  });

  it('saveDeviceToken serializes the token through the keyring command', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await saveDeviceToken(sample);
    expect(invokeMock).toHaveBeenCalledWith('save_device_token', {
      value: JSON.stringify(sample),
    });
  });

  it('saveDeviceToken passes null to clear the keyring', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await saveDeviceToken(null);
    expect(invokeMock).toHaveBeenCalledWith('save_device_token', { value: null });
  });
});

describe('deviceToken fallback (non-Tauri)', () => {
  beforeEach(() => exitTauri());

  it('saveDeviceToken writes to localStorage and loadDeviceToken reads it back', async () => {
    await saveDeviceToken(sample);
    expect(localStorage.getItem(LS_KEY)).toBe(JSON.stringify(sample));
    expect(invokeMock).not.toHaveBeenCalled();

    const result = await loadDeviceToken();
    expect(result).toEqual(sample);
  });

  it('loadDeviceToken returns null when localStorage is empty', async () => {
    expect(await loadDeviceToken()).toBeNull();
  });

  it('saveDeviceToken(null) removes the stored token', async () => {
    await saveDeviceToken(sample);
    await saveDeviceToken(null);
    expect(localStorage.getItem(LS_KEY)).toBeNull();
    expect(await loadDeviceToken()).toBeNull();
  });
});
