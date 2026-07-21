import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

// Mutable so individual tests can move the ACTIVE scope branch away from the
// viewed branch (b1) to exercise the negative / stale-render paths below.
let activeBranchId = 'b1';
vi.mock('../../../store/branchScopeStore', () => ({
  useBranchScopeStore: (sel: (s: { branchId: string }) => unknown) => sel({ branchId: activeBranchId }),
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: () => true, hasIntegration: (d: string) => d === 'fiscal' }),
}));
vi.mock('@/lib/tauri', () => ({ isTauri: () => false, HardwareService: {} }));

import BranchDetailPage from '../BranchDetailPage';

// en/common.json → hummytummy.branchDetail.scopeHint (the real string the
// test-env i18n resolves to — see src/test/setup.ts, which loads the actual
// en/common.json rather than echoing keys back).
const SCOPE_HINT = 'Switch to this branch in the top bar to manage terminals and the cash register.';

// A function, not a shared element constant: rerender()-ing the exact same
// element reference lets React bail out of the subtree (oldProps === newProps
// at every level) and skip re-invoking BranchDetailPage entirely, which would
// mask the very stale-render bug this test targets. A fresh tree each call
// forces a real re-render.
const buildPage = () => (
  <MemoryRouter initialEntries={['/admin/branches/b1']}>
    <Routes><Route path="/admin/branches/:id" element={<BranchDetailPage />} /></Routes>
  </MemoryRouter>
);

const renderPage = () => render(buildPage());

describe('BranchDetailPage — cihaz sekmeleri', () => {
  beforeEach(() => {
    activeBranchId = 'b1';
  });

  it('aktif şubede Terminaller + Yazarkasa sekmeleri görünür; Donanım (Tauri) web-de gizli', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Ödeme Terminalleri|Payment Terminals/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Yazarkasa|Cash Register/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Donanım|Hardware/ })).toBeNull();
  });

  it('aktif olmayan şubede Terminaller/Yazarkasa sekmeleri gizlenir ve scope ipucu gösterilir', () => {
    activeBranchId = 'b2';
    renderPage();
    expect(screen.queryByRole('button', { name: /Ödeme Terminalleri|Payment Terminals/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Yazarkasa|Cash Register/ })).toBeNull();
    expect(screen.getByText(SCOPE_HINT)).toBeTruthy();
  });

  it('aktif şube başka bir şubeye kayınca açık kalan Terminaller içeriği kaybolur (stale-render deliği)', () => {
    const { rerender } = renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Ödeme Terminalleri|Payment Terminals/ }));
    expect(screen.getByText('TERMINALS')).toBeTruthy();

    // Üst çubuktan aktif scope başka bir şubeye geçti — sekme içeriği hâlâ
    // 'terminals' state'inde ama artık bu şube aktif DEĞİL. İçerik kartı da
    // (buton gibi) hemen kaybolmalı; yanlış şubeye yazma penceresi kapanmalı.
    activeBranchId = 'b2';
    rerender(buildPage());

    expect(screen.queryByText('TERMINALS')).toBeNull();
    expect(screen.getByText(SCOPE_HINT)).toBeTruthy();
  });
});
