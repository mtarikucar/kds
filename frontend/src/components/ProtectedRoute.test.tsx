import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '../types';
import ProtectedRoute from './ProtectedRoute';

/**
 * Structural role guard (companion to backend JwtStrategy.validate()'s
 * 401 ACCOUNT_ROLE_INVALID). Before this fix an unrecognized `user.role`
 * (e.g. a raw-DB-planted "OWNER") made Sidebar.itemVisible filter out
 * every nav item (empty sidebar) with no explanation. ProtectedRoute is
 * the single highest-level wrapper around every authenticated route, so
 * the AccountRoleInvalid check here replaces the whole app shell with a
 * clear, actionable message instead.
 */
function renderAt(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <div>Protected content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const baseUser = {
  id: 'u-1',
  email: 'u@example.com',
  firstName: 'Test',
  lastName: 'User',
  tenantId: 't-1',
};

beforeEach(() => {
  // Provide accessToken up front so ProtectedRoute's bootstrap effect
  // (which otherwise POSTs /auth/refresh via axios) short-circuits —
  // `isAuthenticated && !accessToken` is false, so `bootstrapping`
  // starts and stays false synchronously.
  useAuthStore.setState({
    isAuthenticated: true,
    accessToken: 'live-token',
    user: { ...baseUser, role: UserRole.ADMIN } as any,
  });
});

afterEach(() => {
  useAuthStore.getState().logout();
});

describe('ProtectedRoute — structural role guard', () => {
  it('renders children normally for a valid ADMIN', () => {
    renderAt();
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it('renders AccountRoleInvalid (not an empty layout, not a bounce) for an invalid role like "OWNER"', () => {
    useAuthStore.setState({
      user: { ...baseUser, role: 'OWNER' } as any,
    });
    renderAt();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
    expect(
      screen.getByText('Invalid Account Configuration'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
  });

  it('logs the user out when the AccountRoleInvalid "Log out" button is clicked', () => {
    useAuthStore.setState({ user: { ...baseUser, role: 'OWNER' } as any });
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });
});
