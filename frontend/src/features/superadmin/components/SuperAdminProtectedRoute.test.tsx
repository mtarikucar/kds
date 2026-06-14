import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const store = { isAuthenticated: false, requires2FA: false };
vi.mock('../../../store/superAdminAuthStore', () => ({
  useSuperAdminAuthStore: () => store,
}));

import SuperAdminProtectedRoute from './SuperAdminProtectedRoute';

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/superadmin/dashboard']}>
      <Routes>
        <Route element={<SuperAdminProtectedRoute />}>
          <Route
            path="/superadmin/dashboard"
            element={<div>Protected content</div>}
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

describe('SuperAdminProtectedRoute', () => {
  it('redirects to login when unauthenticated and not pending 2FA', () => {
    renderAt();
    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('redirects to the 2FA page when 2FA is pending', () => {
    store.requires2FA = true;
    renderAt();
    expect(screen.getByText('2FA page')).toBeInTheDocument();
  });

  it('renders the outlet when authenticated', () => {
    store.isAuthenticated = true;
    renderAt();
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });
});
