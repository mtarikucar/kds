import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Header from './Header';

/**
 * The "Mağaza" (store hub) navbar entry is nothing but real-money purchases
 * (add-ons + hardware + orders) — the backend 403s any real-money
 * initiation for the shared demo tenant (DEMO_PAYMENT_BLOCKED). A demo
 * explorer must never see the link at all, not just have it dead-end.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: unknown) => (typeof d === 'object' && d && 'defaultValue' in (d as Record<string, unknown>) ? (d as { defaultValue: string }).defaultValue : k) }),
}));

vi.mock('../../features/auth/authApi', () => ({
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../NotificationCenter', () => ({ default: () => null }));
vi.mock('../LanguageSwitcher', () => ({ default: () => null }));
vi.mock('../../features/onboarding', () => ({ MascotButton: () => null }));
vi.mock('./BranchPicker', () => ({ default: () => null }));

let demoMode = false;
let user: { role: string; firstName: string; lastName: string } | null = {
  role: 'ADMIN',
  firstName: 'Ada',
  lastName: 'Min',
};
vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (s: { user: typeof user; demoMode: boolean }) => unknown) =>
    selector({ user, demoMode }),
}));

beforeEach(() => {
  demoMode = false;
  user = { role: 'ADMIN', firstName: 'Ada', lastName: 'Min' };
});

describe('Header — store-hub link demo gating', () => {
  it('not demoMode, ADMIN: the store-hub link is in the document', () => {
    render(
      <MemoryRouter>
        <Header onMenuClick={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /mağaza/i })).toBeInTheDocument();
  });

  it('demoMode, ADMIN: the store-hub link is NOT in the document', () => {
    demoMode = true;
    render(
      <MemoryRouter>
        <Header onMenuClick={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /mağaza/i })).not.toBeInTheDocument();
  });

  it('demoMode, MANAGER: the store-hub link is NOT in the document', () => {
    demoMode = true;
    user = { role: 'MANAGER', firstName: 'Mo', lastName: 'Nager' };
    render(
      <MemoryRouter>
        <Header onMenuClick={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /mağaza/i })).not.toBeInTheDocument();
  });

  it('not demoMode, a role without store access (WAITER): link is still absent (unrelated to demo gating)', () => {
    demoMode = false;
    user = { role: 'WAITER', firstName: 'Wai', lastName: 'Ter' };
    render(
      <MemoryRouter>
        <Header onMenuClick={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /mağaza/i })).not.toBeInTheDocument();
  });
});
