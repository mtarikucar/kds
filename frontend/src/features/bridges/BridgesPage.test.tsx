import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import enBridges from '../../i18n/locales/en/bridges.json';
import type { LocalBridge } from './bridgesApi';

// BridgesPage owns: the provisioning draft (branch/sku/hostname), the create
// flow (mutateAsync -> one-time provisioning-token banner), the bridge list
// (branch-name lookup, status pill) and the retire button gated by
// window.confirm. We mock the api hooks + branch list and register the
// `bridges` namespace so assertions read real English copy.

const bridgesState: { data: LocalBridge[]; isLoading: boolean } = { data: [], isLoading: false };
const create = { mutateAsync: vi.fn(), isPending: false };
const retire = { mutate: vi.fn() };
const branches = [
  { id: 'br-1', name: 'Kadıköy Şube' },
  { id: 'br-2', name: 'Ankara Şube' },
];

vi.mock('./bridgesApi', () => ({
  useListBridges: () => bridgesState,
  useCreateBridge: () => create,
  useRetireBridge: () => retire,
}));
vi.mock('../branches/branchesApi', () => ({
  useListBranches: () => ({ data: branches }),
}));

import BridgesPage from './BridgesPage';

beforeAll(() => {
  i18next.addResourceBundle('en', 'bridges', enBridges, true, true);
});

function makeBridge(over: Partial<LocalBridge> = {}): LocalBridge {
  return {
    id: 'b-1',
    tenantId: 't-1',
    branchId: 'br-1',
    hostname: 'hummybox-01',
    os: null,
    agentVersion: null,
    status: 'online',
    lastSeenAt: null,
    provisionedAt: null,
    productSku: 'hummybox-lite',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('BridgesPage', () => {
  beforeEach(() => {
    bridgesState.data = [];
    bridgesState.isLoading = false;
    create.isPending = false;
    create.mutateAsync.mockReset();
    retire.mutate.mockReset();
    vi.restoreAllMocks();
  });

  it('disables Provision until a branch is selected, then posts the draft', async () => {
    create.mutateAsync.mockResolvedValue(makeBridge({ provisioningToken: undefined }));
    render(<BridgesPage />);

    const provision = screen.getByRole('button', { name: 'Provision' });
    expect(provision).toBeDisabled();

    // There are two selects (branch + sku); the branch select is first.
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'br-2' } });
    // hostname is the only text input on the page.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'box-42' } });

    expect(provision).toBeEnabled();
    fireEvent.click(provision);

    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalledTimes(1));
    expect(create.mutateAsync).toHaveBeenCalledWith({
      branchId: 'br-2',
      productSku: 'hummybox-lite',
      hostname: 'box-42',
    });
  });

  it('shows the one-time provisioning-token banner after a successful create', async () => {
    create.mutateAsync.mockResolvedValue(makeBridge({ provisioningToken: 'prov_TOKEN_123' }));
    render(<BridgesPage />);

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'br-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Provision' }));

    await waitFor(() => expect(screen.getByText('Bridge provisioned.')).toBeInTheDocument());
    expect(screen.getByText('prov_TOKEN_123')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: enBridges.provisioned.copied }));
    await waitFor(() => expect(screen.queryByText('prov_TOKEN_123')).not.toBeInTheDocument());
  });

  it('renders the empty-list copy when there are no bridges', () => {
    bridgesState.data = [];
    render(<BridgesPage />);
    expect(screen.getByText('No bridges provisioned yet.')).toBeInTheDocument();
  });

  it('resolves the branch name from the branch list and renders the status pill', () => {
    bridgesState.data = [makeBridge({ branchId: 'br-2', status: 'online', hostname: 'edge-1' })];
    render(<BridgesPage />);

    // The row's hostname cell anchors the row; the branch name is resolved
    // from the branch list lookup. (The name also appears as an <option> in
    // the create select, so scope the branch-name assertion to the row.)
    const row = screen.getByText('edge-1').closest('tr')!;
    expect(row).toHaveTextContent('Ankara Şube'); // branchId br-2 -> name

    const pill = screen.getByText('online');
    expect(pill.className).toContain('bg-green-100');
  });

  it('falls back to the em-dash when the bridge points at an unknown branch', () => {
    bridgesState.data = [makeBridge({ branchId: 'gone', hostname: null })];
    render(<BridgesPage />);
    // Both branch cell and hostname cell render "—".
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('retires the bridge only after window.confirm returns true', () => {
    bridgesState.data = [makeBridge({ id: 'bridge-9' })];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<BridgesPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
    expect(confirmSpy).toHaveBeenCalledWith('Retire this bridge?');
    expect(retire.mutate).toHaveBeenCalledWith('bridge-9');
  });

  it('does NOT retire when window.confirm is cancelled', () => {
    bridgesState.data = [makeBridge({ id: 'bridge-9' })];
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<BridgesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
    expect(retire.mutate).not.toHaveBeenCalled();
  });
});
