import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SetupChecklist from './SetupChecklist';

// All four data hooks are mocked so the checklist can be exercised across
// real combinations of (branches/devices/bridges/entitlements). Each test
// pins one branch of the visibility logic.

vi.mock('../entitlements/entitlementsApi', () => ({
  useGetMyEntitlements: () => ({ data: globalThis.__ents }),
}));
vi.mock('../branches/branchesApi', () => ({
  useListBranches: () => ({ data: globalThis.__branches ?? [] }),
}));
vi.mock('../devices/devicesApi', () => ({
  useListDevices: () => ({ data: globalThis.__devices ?? [] }),
}));
vi.mock('../bridges/bridgesApi', () => ({
  useListBridges: () => ({ data: globalThis.__bridges ?? [] }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => (opts?.label ? `Go to ${opts.label} →` : key),
  }),
}));

declare global {
  // eslint-disable-next-line no-var
  var __ents: any;
  // eslint-disable-next-line no-var
  var __branches: any;
  // eslint-disable-next-line no-var
  var __devices: any;
  // eslint-disable-next-line no-var
  var __bridges: any;
}

function renderChecklist() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SetupChecklist />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SetupChecklist', () => {
  it('renders nothing when every item is satisfied', () => {
    globalThis.__ents = {
      features: { 'feature.kdsIntegration': true },
      integrations: { 'integration.fiscal': ['efatura'] },
    };
    globalThis.__branches = [{ id: 'b1' }];
    globalThis.__devices = [
      { kind: 'kds_screen', status: 'online' },
      { kind: 'tablet_waiter', status: 'online' },
    ];
    globalThis.__bridges = [];

    const { container } = renderChecklist();
    expect(container.firstChild).toBeNull();
  });

  it('shows the branch item and labels it incomplete when no branches exist', () => {
    globalThis.__ents = { features: {}, integrations: {} };
    globalThis.__branches = [];
    globalThis.__devices = [];
    globalThis.__bridges = [];

    renderChecklist();
    expect(screen.getByText('hummytummy.setupChecklist.items.branch')).toBeInTheDocument();
  });

  it('hides the KDS item when the tenant does not have the kds feature', () => {
    globalThis.__ents = { features: {}, integrations: {} };  // no kdsIntegration
    globalThis.__branches = [{ id: 'b1' }];
    globalThis.__devices = [];
    globalThis.__bridges = [];

    renderChecklist();
    // KDS item is skipped because the entitlement is absent.
    expect(screen.queryByText('hummytummy.setupChecklist.items.kds')).not.toBeInTheDocument();
  });

  it('hides the bridge item until a bridge-dependent device is present', () => {
    globalThis.__ents = { features: {}, integrations: {} };
    globalThis.__branches = [{ id: 'b1' }];
    globalThis.__devices = [{ kind: 'tablet_waiter', status: 'online' }];
    globalThis.__bridges = [];

    renderChecklist();
    // No yazarkasa/printer/POS → bridge item skipped.
    expect(screen.queryByText('hummytummy.setupChecklist.items.bridge')).not.toBeInTheDocument();
  });

  it('shows the bridge item once a yazarkasa device is present', () => {
    globalThis.__ents = { features: {}, integrations: {} };
    globalThis.__branches = [{ id: 'b1' }];
    globalThis.__devices = [{ kind: 'yazarkasa', status: 'online' }];
    globalThis.__bridges = [];

    renderChecklist();
    expect(screen.getByText('hummytummy.setupChecklist.items.bridge')).toBeInTheDocument();
  });
});
