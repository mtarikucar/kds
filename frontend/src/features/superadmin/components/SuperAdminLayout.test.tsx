import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const store = { isAuthenticated: false, requires2FA: false };
vi.mock('../../../store/superAdminAuthStore', () => ({
  useSuperAdminAuthStore: () => store,
}));
// The sidebar pulls in headlessui + the logout API; stub it so this test
// isolates the layout's auth-gating + outlet rendering.
vi.mock('./SuperAdminSidebar', () => ({
  default: () => <div>Sidebar</div>,
}));

import SuperAdminLayout from './SuperAdminLayout';

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/superadmin/dashboard']}>
      <Routes>
        <Route element={<SuperAdminLayout />}>
          <Route
            path="/superadmin/dashboard"
            element={<div>Dashboard outlet</div>}
          />
        </Route>
        <Route path="/superadmin/login" element={<div>Login page</div>} />
        <Route path="/superadmin/2fa" element={<div>2FA page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  store.isAuthenticated = false;
  store.requires2FA = false;
});

describe('SuperAdminLayout', () => {
  it('redirects unauthenticated users to login', () => {
    renderAt();
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('redirects to 2FA when authenticated but 2FA is pending', () => {
    store.isAuthenticated = true;
    store.requires2FA = true;
    renderAt();
    expect(screen.getByText('2FA page')).toBeInTheDocument();
  });

  it('renders the sidebar and outlet when fully authenticated', () => {
    store.isAuthenticated = true;
    renderAt();
    expect(screen.getByText('Sidebar')).toBeInTheDocument();
    expect(screen.getByText('Dashboard outlet')).toBeInTheDocument();
  });
});
