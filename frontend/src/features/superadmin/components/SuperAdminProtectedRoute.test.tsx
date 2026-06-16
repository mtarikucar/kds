import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const store: {
  isAuthenticated: boolean;
  requires2FA: boolean;
  accessToken: string | null;
} = { isAuthenticated: false, requires2FA: false, accessToken: null };

const logout = vi.fn(() => {
  store.isAuthenticated = false;
  store.accessToken = null;
});

// The component calls restoreSuperAdminSession() on reload (store rehydrates
// `isAuthenticated` but tokens are intentionally NOT persisted).
const restoreSuperAdminSession = vi.fn();

vi.mock('../../../store/superAdminAuthStore', () => {
  const useSuperAdminAuthStore = () => store;
  useSuperAdminAuthStore.getState = () => ({ logout });
  return { useSuperAdminAuthStore };
});

vi.mock('../api/superAdminApi', () => ({
  restoreSuperAdminSession: () => restoreSuperAdminSession(),
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
  store.accessToken = null;
  logout.mockClear();
  restoreSuperAdminSession.mockReset();
  restoreSuperAdminSession.mockResolvedValue(undefined);
});

describe('SuperAdminProtectedRoute', () => {
  it('redirects to login when unauthenticated and not pending 2FA', () => {
    renderAt();
    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(restoreSuperAdminSession).not.toHaveBeenCalled();
  });

  it('redirects to the 2FA page when 2FA is pending', () => {
    store.requires2FA = true;
    renderAt();
    expect(screen.getByText('2FA page')).toBeInTheDocument();
  });

  it('renders the outlet when authenticated with a live access token', () => {
    store.isAuthenticated = true;
    store.accessToken = 'live-token';
    renderAt();
    expect(screen.getByText('Protected content')).toBeInTheDocument();
    // A live token in memory means no silent restore is needed.
    expect(restoreSuperAdminSession).not.toHaveBeenCalled();
  });

  it('silently restores the session on reload, then renders the outlet', async () => {
    // Reload: store rehydrated isAuthenticated=true but the access token was
    // never persisted, so it starts null and must be re-minted via the cookie.
    store.isAuthenticated = true;
    store.accessToken = null;
    restoreSuperAdminSession.mockImplementation(async () => {
      store.accessToken = 'restored-token';
    });

    renderAt();

    expect(restoreSuperAdminSession).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByText('Protected content')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  });

  it('redirects to login when the session cannot be restored', async () => {
    store.isAuthenticated = true;
    store.accessToken = null;
    restoreSuperAdminSession.mockRejectedValue(new Error('no refresh cookie'));

    renderAt();

    await waitFor(() =>
      expect(screen.getByText('Login page')).toBeInTheDocument(),
    );
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });
});
