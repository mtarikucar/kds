import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  listResult: {
    data: [] as any[],
    isLoading: false,
    refetch: vi.fn(),
  },
  enqueueMutate: vi.fn(),
  enqueuePending: false,
  lastListArgs: [] as unknown[],
}));

vi.mock('./devicesApi', () => ({
  useListDeviceCommands: (...args: unknown[]) => {
    h.lastListArgs = args;
    return h.listResult;
  },
  useEnqueueCommand: () => ({
    mutate: h.enqueueMutate,
    isPending: h.enqueuePending,
  }),
}));

import DeviceCommandsDrawer from './DeviceCommandsDrawer';

beforeEach(() => {
  h.listResult.data = [];
  h.listResult.isLoading = false;
  h.listResult.refetch = vi.fn();
  h.enqueueMutate = vi.fn();
  h.enqueuePending = false;
});

describe('DeviceCommandsDrawer', () => {
  it('renders the device id header', () => {
    render(<DeviceCommandsDrawer deviceId="dev-1" onClose={() => {}} />);
    expect(screen.getByText('dev-1')).toBeInTheDocument();
  });

  it('shows a loading state', () => {
    h.listResult.isLoading = true;
    render(<DeviceCommandsDrawer deviceId="dev-1" onClose={() => {}} />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no commands', () => {
    render(<DeviceCommandsDrawer deviceId="dev-1" onClose={() => {}} />);
    expect(screen.getByText('No commands in this view.')).toBeInTheDocument();
  });

  it('renders command rows with kind, status and error', () => {
    h.listResult.data = [
      {
        id: 'c1',
        kind: 'reboot',
        status: 'failed',
        attempts: 3,
        error: 'timed out',
        result: null,
        createdAt: new Date().toISOString(),
      },
    ];
    render(<DeviceCommandsDrawer deviceId="dev-1" onClose={() => {}} />);
    expect(screen.getByText('reboot')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('timed out')).toBeInTheDocument();
    // attempts > 1 renders a multiplier badge
    expect(screen.getByText('×3')).toBeInTheDocument();
  });

  it('enqueues a capability_probe when "Send probe" is clicked', async () => {
    render(<DeviceCommandsDrawer deviceId="dev-1" onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send probe' }));
    expect(h.enqueueMutate).toHaveBeenCalledTimes(1);
    expect(h.enqueueMutate.mock.calls[0][0]).toMatchObject({
      kind: 'capability_probe',
      priority: 9,
    });
  });

  it('applies the selected status filter to the query', async () => {
    render(<DeviceCommandsDrawer deviceId="dev-1" onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Failed' }));
    // The hook is re-invoked with the chosen filter value.
    expect(h.lastListArgs).toEqual(['dev-1', 'failed']);
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<DeviceCommandsDrawer deviceId="dev-1" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
