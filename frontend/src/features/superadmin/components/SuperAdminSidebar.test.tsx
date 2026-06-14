import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mutate = vi.fn();
vi.mock('../../../store/superAdminAuthStore', () => ({
  useSuperAdminAuthStore: () => ({
    superAdmin: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@x.io',
    },
  }),
}));
vi.mock('../api/superAdminApi', () => ({
  useSuperAdminLogout: () => ({ mutate }),
}));

import SuperAdminSidebar from './SuperAdminSidebar';

function renderSidebar() {
  return render(
    <MemoryRouter>
      <SuperAdminSidebar />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mutate.mockReset();
});

describe('SuperAdminSidebar', () => {
  it('renders every primary navigation link with its destination', () => {
    renderSidebar();
    const expected = [
      '/superadmin/dashboard',
      '/superadmin/tenants',
      '/superadmin/users',
      '/superadmin/plans',
      '/superadmin/marketplace',
      '/superadmin/subscriptions',
      '/superadmin/audit-logs',
      '/superadmin/settings',
    ];
    const hrefs = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expected.forEach((href) => expect(hrefs).toContain(href));
  });

  it('shows the operator initials and email', () => {
    renderSidebar();
    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(screen.getByText('ada@x.io')).toBeInTheDocument();
  });

  it('fires the logout mutation when sign-out is clicked', async () => {
    renderSidebar();
    // Open the headlessui menu, then click the sign-out item.
    await userEvent.click(screen.getByText('ada@x.io'));
    const signOut = await screen.findByRole('menuitem');
    await userEvent.click(signOut);
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
