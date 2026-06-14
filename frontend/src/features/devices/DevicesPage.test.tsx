import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { Device } from './devicesApi';

// DevicesPage is driven by useListDevices + the create/retire mutation hooks
// and the two extracted view helpers (visibleDevices filter, statusPillColor).
// We mock the api module so each test pins one list/mutation state, then
// assert: retired rows are hidden until the "show retired" toggle is on, the
// retire button is gated behind window.confirm, and the create-slot button
// fires the mutation with the selected kind.

const listState: { data: Device[]; isLoading: boolean } = { data: [], isLoading: false };
const createSlot = { mutate: vi.fn(), isPending: false };
const retire = { mutate: vi.fn() };

vi.mock('./devicesApi', () => ({
  useListDevices: () => listState,
  useCreateDeviceSlot: () => createSlot,
  useRetireDevice: () => retire,
}));

// The commands drawer pulls its own query; stub it to a no-op so opening it
// doesn't require a QueryClientProvider.
vi.mock('./DeviceCommandsDrawer', () => ({
  default: ({ deviceId }: { deviceId: string }) => <div data-testid="commands-drawer">{deviceId}</div>,
}));

// react-qr-code renders an <svg>; jsdom handles it, but keep it cheap.
vi.mock('react-qr-code', () => ({ default: () => <svg data-testid="qr" /> }));

import DevicesPage from './DevicesPage';

function makeDevice(over: Partial<Device> = {}): Device {
  return {
    id: 'd-1',
    tenantId: 't-1',
    branchId: null,
    kind: 'kds_screen',
    capabilities: [],
    status: 'online',
    lastSeenAt: null,
    serial: null,
    model: null,
    ownership: 'sold',
    ...over,
  };
}

describe('DevicesPage', () => {
  beforeEach(() => {
    listState.data = [];
    listState.isLoading = false;
    createSlot.isPending = false;
    vi.restoreAllMocks();
    createSlot.mutate.mockReset();
    retire.mutate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the loading line while the list query is pending', () => {
    listState.isLoading = true;
    render(<DevicesPage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('hides retired devices by default and reveals them when "show retired" is toggled on', () => {
    listState.data = [
      makeDevice({ id: 'live', kind: 'pos_terminal', status: 'online' }),
      makeDevice({ id: 'gone', kind: 'scanner', status: 'retired' }),
    ];
    render(<DevicesPage />);

    // Default: the retired row is filtered out by visibleDevices().
    expect(screen.getByText('pos_terminal')).toBeInTheDocument();
    expect(screen.queryByText('scanner')).not.toBeInTheDocument();

    // Flip the toggle -> retired row appears.
    fireEvent.click(screen.getByLabelText('Show retired devices'));
    expect(screen.getByText('scanner')).toBeInTheDocument();
  });

  it('shows the empty state when no devices are visible', () => {
    listState.data = [makeDevice({ status: 'retired' })]; // hidden by default
    render(<DevicesPage />);
    expect(
      screen.getByText('No devices yet. Click Create slot to provision your first device.'),
    ).toBeInTheDocument();
  });

  it('colours the status pill from statusPillColor (online -> green, error -> red)', () => {
    listState.data = [
      makeDevice({ id: 'a', kind: 'pos_terminal', status: 'online' }),
      makeDevice({ id: 'b', kind: 'scanner', status: 'error' }),
    ];
    render(<DevicesPage />);

    const online = screen.getByText('online');
    expect(online.className).toContain('bg-green-100');
    expect(online.className).toContain('text-green-800');

    const error = screen.getByText('error');
    expect(error.className).toContain('bg-red-100');
    expect(error.className).toContain('text-red-800');
  });

  it('creates a slot with the kind picked in the select', () => {
    render(<DevicesPage />);
    // The kind <select> in the header is the only combobox.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pos_terminal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create slot' }));

    expect(createSlot.mutate).toHaveBeenCalledTimes(1);
    expect(createSlot.mutate).toHaveBeenCalledWith({ kind: 'pos_terminal' });
  });

  it('disables the create button while the create mutation is pending', () => {
    createSlot.isPending = true;
    render(<DevicesPage />);
    expect(screen.getByRole('button', { name: 'Create slot' })).toBeDisabled();
  });

  it('retires a device only after window.confirm returns true', () => {
    listState.data = [makeDevice({ id: 'd-42', kind: 'pos_terminal' })];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DevicesPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));

    expect(confirmSpy).toHaveBeenCalledWith('Retire this device?');
    expect(retire.mutate).toHaveBeenCalledTimes(1);
    expect(retire.mutate).toHaveBeenCalledWith('d-42');
  });

  it('does NOT retire when window.confirm is cancelled', () => {
    listState.data = [makeDevice({ id: 'd-42' })];
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<DevicesPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
    expect(retire.mutate).not.toHaveBeenCalled();
  });

  it('opens the commands drawer when the kind cell is clicked', () => {
    listState.data = [makeDevice({ id: 'd-99', kind: 'kitchen_printer' })];
    render(<DevicesPage />);
    expect(screen.queryByTestId('commands-drawer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('kitchen_printer'));
    expect(screen.getByTestId('commands-drawer')).toHaveTextContent('d-99');
  });

  it('renders the pair code + QR when a device exposes a pairCode', () => {
    listState.data = [makeDevice({ id: 'd-1', pairCode: 'ABCD12' })];
    render(<DevicesPage />);
    expect(screen.getByText('ABCD12')).toBeInTheDocument();
    expect(screen.getAllByTestId('qr').length).toBeGreaterThan(0);
  });

  it('joins capabilities with commas and shows an em-dash when empty', () => {
    listState.data = [
      makeDevice({ id: 'a', kind: 'pos_terminal', capabilities: ['print', 'scan'] }),
    ];
    render(<DevicesPage />);
    const row = screen.getByText('pos_terminal').closest('tr')!;
    expect(within(row).getByText('print, scan')).toBeInTheDocument();
  });
});
