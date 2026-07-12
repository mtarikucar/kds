import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));
vi.mock('../../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => h.get(...a),
    post: (...a: unknown[]) => h.post(...a),
    put: (...a: unknown[]) => h.put(...a),
    delete: (...a: unknown[]) => h.del(...a),
  },
}));
vi.mock('../../../store/branchScopeStore', () => ({
  useBranchScopeStore: (sel: (s: { branchId: string | null }) => unknown) =>
    sel({ branchId: 'branch-A' }),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import CameraManagement from './CameraManagement';

// ErrorState -> lib/api-error -> i18n/config pulls the FULL locale bundle
// into this test, so t() resolves to the real English strings (unlike the
// key-echo harness some sibling tests rely on). Assert on the en copy.
const CAM = {
  id: 'cam-1',
  name: 'Salon',
  description: 'Above the entrance',
  streamUrl: 'rtsp://cam/1',
  streamType: 'RTSP',
  status: 'ONLINE',
  lastSeenAt: '2026-07-10T10:00:00.000Z',
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-10T10:00:00.000Z',
};

function mockBackend(cameras: unknown[]) {
  h.get.mockImplementation(async (url: string) => {
    if (url === '/analytics/cameras/health') {
      return {
        data: {
          total: cameras.length,
          online: cameras.length,
          offline: 0,
          error: 0,
          calibrating: 0,
        },
      };
    }
    return { data: cameras };
  });
}

function renderCameras() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <CameraManagement />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(h).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset());
});

describe('CameraManagement', () => {
  it('shows the honest empty state with a setup CTA when no cameras exist', async () => {
    mockBackend([]);
    renderCameras();

    expect(
      await screen.findByText('No cameras connected yet'),
    ).toBeInTheDocument();
    // Honest copy: hardware requirement + what still works without it.
    expect(
      screen.getByText(/requires an on-site camera installation/i),
    ).toBeInTheDocument();
    // Empty-state CTA opens the add-camera modal.
    const ctas = screen.getAllByRole('button', { name: 'Add Camera' });
    await userEvent.click(ctas[ctas.length - 1]);
    expect(screen.getByLabelText('Camera name')).toBeInTheDocument();
  });

  it('creates a camera through the add form (POST /analytics/cameras)', async () => {
    mockBackend([]);
    h.post.mockResolvedValue({ data: { ...CAM, id: 'cam-new' } });
    renderCameras();

    const ctas = await screen.findAllByRole('button', { name: 'Add Camera' });
    await userEvent.click(ctas[ctas.length - 1]);

    await userEvent.type(screen.getByLabelText('Camera name'), 'Salon');
    await userEvent.type(screen.getByLabelText('Stream URL'), 'rtsp://cam/1');
    // Submit button is the last "Add Camera" (empty-state CTA + modal submit).
    const buttons = screen.getAllByRole('button', { name: 'Add Camera' });
    await userEvent.click(buttons[buttons.length - 1]);

    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith('/analytics/cameras', {
        name: 'Salon',
        description: undefined,
        streamUrl: 'rtsp://cam/1',
        streamType: 'RTSP',
      }),
    );
  });

  it('deletes a camera only after the confirmation step', async () => {
    mockBackend([CAM]);
    h.del.mockResolvedValue({ data: undefined });
    renderCameras();

    expect(await screen.findByText('Salon')).toBeInTheDocument();

    // Row action opens the confirm modal — nothing deleted yet.
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(h.del).not.toHaveBeenCalled();
    expect(
      screen.getByText(/delete the camera "Salon"/i),
    ).toBeInTheDocument();

    // Confirm — DELETE fires with the camera id.
    const confirmButtons = screen.getAllByRole('button', { name: 'Delete' });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() =>
      expect(h.del).toHaveBeenCalledWith('/analytics/cameras/cam-1'),
    );
  });
});
