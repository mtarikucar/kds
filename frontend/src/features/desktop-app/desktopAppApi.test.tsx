import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => h.get(...a),
    post: (...a: unknown[]) => h.post(...a),
  },
}));

import {
  useLatestRelease,
  usePublishedReleases,
  trackDownload,
  getPlatformInfo,
  type DesktopRelease,
} from './desktopAppApi';

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.get.mockReset();
  h.post.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
});

describe('desktopAppApi queries', () => {
  it('useLatestRelease GETs the latest endpoint', async () => {
    h.get.mockResolvedValue({ data: { version: '1.0.0' } });
    const { result } = renderHook(() => useLatestRelease(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.get).toHaveBeenCalledWith('/desktop/releases/latest');
  });

  it('usePublishedReleases GETs the published endpoint', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => usePublishedReleases(), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/desktop/releases/published'),
    );
  });
});

describe('trackDownload', () => {
  it('POSTs the download-tracking endpoint', async () => {
    h.post.mockResolvedValue({ data: {} });
    await trackDownload('1.2.3', 'windows');
    expect(h.post).toHaveBeenCalledWith(
      '/desktop/releases/1.2.3/download/windows',
    );
  });

  it('swallows errors so download flow is never blocked', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.post.mockRejectedValue(new Error('network'));
    await expect(trackDownload('1.2.3', 'linux')).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe('getPlatformInfo', () => {
  it('returns four platforms with no download URLs when release is undefined', () => {
    const platforms = getPlatformInfo(undefined);
    expect(platforms.map((p) => p.id)).toEqual([
      'windows',
      'macArm',
      'macIntel',
      'linux',
    ]);
    expect(platforms.every((p) => p.downloadUrl === undefined)).toBe(true);
  });

  it('maps each platform URL from the release', () => {
    const release = {
      windowsUrl: 'win',
      macArmUrl: 'arm',
      macIntelUrl: 'intel',
      linuxUrl: 'lin',
    } as DesktopRelease;
    const platforms = getPlatformInfo(release);
    expect(platforms.find((p) => p.id === 'windows')?.downloadUrl).toBe('win');
    expect(platforms.find((p) => p.id === 'macArm')?.downloadUrl).toBe('arm');
    expect(platforms.find((p) => p.id === 'macIntel')?.downloadUrl).toBe(
      'intel',
    );
    expect(platforms.find((p) => p.id === 'linux')?.downloadUrl).toBe('lin');
  });
});
