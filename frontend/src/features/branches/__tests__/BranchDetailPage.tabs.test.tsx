import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// NOTE: brief's guessed mock path was '../branchApi' — the real module is
// './branchesApi' (useGetBranch/useUpdateBranch); useGetHealthOverview
// lives in a separate '../health/healthApi' module. Mocked against the
// actual BranchDetailPage.tsx imports.
vi.mock('../branchesApi', () => ({
  useGetBranch: () => ({
    data: { id: 'b1', name: 'Merkez', code: 'M1', timezone: 'Europe/Istanbul', status: 'active', isHeadquarters: false },
    isLoading: false,
    isError: false,
  }),
  useUpdateBranch: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../health/healthApi', () => ({
  useGetHealthOverview: () => ({ data: [] }),
}));
vi.mock('../../devices/DeviceManagerSection', () => ({ default: () => <div>MESH</div> }));
vi.mock('../BranchNetworkSection', () => ({ default: () => <div>NETWORK</div> }));
vi.mock('../../../pages/settings/PaymentTerminalsSettingsPage', () => ({
  PaymentTerminalsPanel: () => <div>TERMINALS</div>,
}));
vi.mock('../../fiscal/FiscalDevicesPanel', () => ({ FiscalDevicesPanel: () => <div>YAZARKASA</div> }));
vi.mock('../../../store/branchScopeStore', () => ({
  useBranchScopeStore: (sel: (s: { branchId: string }) => unknown) => sel({ branchId: 'b1' }),
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: () => true, hasIntegration: (d: string) => d === 'fiscal' }),
}));
vi.mock('@/lib/tauri', () => ({ isTauri: () => false, HardwareService: {} }));

import BranchDetailPage from '../BranchDetailPage';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin/branches/b1']}>
      <Routes><Route path="/admin/branches/:id" element={<BranchDetailPage />} /></Routes>
    </MemoryRouter>,
  );

describe('BranchDetailPage — cihaz sekmeleri', () => {
  it('aktif şubede Terminaller + Yazarkasa sekmeleri görünür; Donanım (Tauri) web-de gizli', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Ödeme Terminalleri|Payment Terminals/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Yazarkasa|Cash Register/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Donanım|Hardware/ })).toBeNull();
  });
});
