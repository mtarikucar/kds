import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  releaseState: { data: undefined as any, isLoading: false, error: null as unknown },
  trackDownload: vi.fn(),
}));

vi.mock('../../features/desktop-app/desktopAppApi', () => ({
  useLatestRelease: () => h.releaseState,
  trackDownload: (...a: unknown[]) => h.trackDownload(...a),
  // Re-use the real platform mapping shape; one platform with a URL is enough.
  getPlatformInfo: (release: any) => [
    {
      id: 'windows',
      name: 'Windows',
      icon: '🪟',
      description: 'Win 10/11',
      fileSize: '',
      downloadUrl: release?.windowsUrl,
    },
  ],
}));

import DesktopAppSettingsPage from './DesktopAppSettingsPage';

beforeEach(() => {
  h.releaseState.data = undefined;
  h.releaseState.isLoading = false;
  h.releaseState.error = null;
  h.trackDownload.mockReset();
});

describe('DesktopAppSettingsPage', () => {
  it('shows the loading state', () => {
    h.releaseState.isLoading = true;
    render(<DesktopAppSettingsPage />);
    expect(screen.getByText('loadingDesktopAppInfo')).toBeInTheDocument();
  });

  it('shows the no-releases error state', () => {
    h.releaseState.error = new Error('none');
    render(<DesktopAppSettingsPage />);
    expect(screen.getByText('noDesktopReleasesTitle')).toBeInTheDocument();
  });

  it('renders the latest version banner when a release exists', () => {
    h.releaseState.data = {
      version: '1.4.0',
      pubDate: '2024-01-01',
      windowsUrl: 'https://dl/win.exe',
      releaseNotes: 'notes',
    };
    render(<DesktopAppSettingsPage />);
    expect(screen.getByText('v1.4.0')).toBeInTheDocument();
  });

  it('tracks the download and opens the URL when a platform has one', async () => {
    h.releaseState.data = {
      version: '1.4.0',
      pubDate: '2024-01-01',
      windowsUrl: 'https://dl/win.exe',
      releaseNotes: 'notes',
    };
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    h.trackDownload.mockResolvedValue(undefined);
    render(<DesktopAppSettingsPage />);
    // The card itself is a button; the inner (last) button is the download CTA.
    const downloadButtons = screen.getAllByRole('button', {
      name: /downloadBtn/i,
    });
    await userEvent.click(downloadButtons[downloadButtons.length - 1]);
    expect(h.trackDownload).toHaveBeenCalledWith('1.4.0', 'windows');
    expect(openSpy).toHaveBeenCalledWith('https://dl/win.exe', '_blank');
    openSpy.mockRestore();
  });

  it('alerts when the chosen platform has no download URL', async () => {
    h.releaseState.data = {
      version: '1.4.0',
      pubDate: '2024-01-01',
      // no windowsUrl -> downloadUrl undefined
      releaseNotes: 'notes',
    };
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<DesktopAppSettingsPage />);
    const downloadButtons = screen.getAllByRole('button', {
      name: /downloadBtn/i,
    });
    await userEvent.click(downloadButtons[downloadButtons.length - 1]);
    expect(alertSpy).toHaveBeenCalledWith('downloadNotAvailable');
    expect(h.trackDownload).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
