import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/test-utils';

/**
 * Latent bug (audit finding 7): an unrecognized `role` value used to
 * render a raw untranslated i18n key + a generic gray badge, making bad
 * data invisible to an admin looking right at the table. Now an
 * unrecognized role gets a distinct warning badge showing the raw value.
 */

const h = vi.hoisted(() => ({
  rows: [
    {
      id: 'u-1',
      email: 'admin@example.com',
      firstName: 'Ada',
      lastName: 'Min',
      role: 'ADMIN',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01').toISOString(),
    },
    {
      id: 'u-2',
      email: 'ghost@example.com',
      firstName: 'Gary',
      lastName: 'Host',
      role: 'OWNER', // planted directly in Postgres — not a valid UserRole
      status: 'ACTIVE',
      createdAt: new Date('2026-01-02').toISOString(),
    },
  ],
}));

vi.mock('../../api/usersApi', () => ({
  usersApi: {
    getAll: vi.fn().mockResolvedValue({ data: h.rows, total: h.rows.length, page: 1, limit: 100 }),
  },
}));

vi.mock('../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({
    hasFeature: () => false,
    checkLimit: () => ({ allowed: true, current: 0, limit: 10, remaining: 10 }),
  }),
}));

vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({ user: { id: 'u-1', role: 'ADMIN' } }),
}));

import UserManagementPage from './UserManagementPage';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UserManagementPage — unknown-role badge', () => {
  it('renders a warning badge with the raw value for an unrecognized role, and the normal badge for a valid one', async () => {
    renderWithProviders(<UserManagementPage />);

    // Wait for the table rows to load.
    await waitFor(() =>
      expect(screen.getByText('admin@example.com')).toBeInTheDocument(),
    );

    // Valid role keeps its normal translated badge, scoped to its own row
    // (the role FILTER <select> also has an "Admin" <option>, so a
    // page-wide query would be ambiguous).
    const validRow = screen.getByText('admin@example.com').closest('tr')!;
    expect(within(validRow).getByText('Admin')).toBeInTheDocument();

    // Unrecognized role: raw value surfaced, not a silent gray/raw-key fallback.
    const invalidRow = screen.getByText('ghost@example.com').closest('tr')!;
    expect(within(invalidRow).getByText(/OWNER/)).toBeInTheDocument();
    const warningBadgeText = within(invalidRow).getByText(/Unknown role/i);
    expect(warningBadgeText).toBeInTheDocument();

    // Warning styling (amber/red), not the generic gray fallback class.
    const warningBadge = warningBadgeText.closest('span');
    expect(warningBadge?.className).toMatch(/bg-red-100|bg-amber-100/);
    expect(warningBadge?.className).not.toMatch(/bg-slate-100/);
  });
});
