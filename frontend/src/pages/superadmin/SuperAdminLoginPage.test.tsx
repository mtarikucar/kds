import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import SuperAdminLoginPage from './SuperAdminLoginPage';
import { useSuperAdminAuthStore } from '../../store/superAdminAuthStore';

// getApiErrorMessage only reads the body off genuine AxiosErrors
// (isAxiosError gate), so the fixtures construct a real one carrying the
// server message rather than a bare { response } literal.
function axiosErrorWithMessage(message: string): AxiosError {
  const err = new AxiosError('Request failed');
  err.response = { data: { message } } as AxiosError['response'];
  return err;
}

const loginMutate = vi.fn();
let loginState: { isError: boolean; error: unknown; isPending: boolean };

vi.mock('../../features/superadmin/api/superAdminApi', () => ({
  useSuperAdminLogin: () => ({ mutate: loginMutate, ...loginState }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// getApiErrorMessage imports i18n/config, which would eagerly re-init i18next
// against the partial react-i18next mock. Stub it.
vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));

function resetStore() {
  useSuperAdminAuthStore.setState({
    superAdmin: null,
    accessToken: null,
    refreshToken: null,
    tempToken: null,
    isAuthenticated: false,
    requires2FA: false,
    requires2FASetup: false,
  });
}

function renderAt(initialPath = '/superadmin/login') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/superadmin/login" element={<SuperAdminLoginPage />} />
          <Route path="/superadmin/2fa" element={<div>2FA-ROUTE</div>} />
          <Route path="/superadmin/dashboard" element={<div>DASHBOARD-ROUTE</div>} />
          <Route path="/superadmin/tenants/:id" element={<div>TENANT-DETAIL-ROUTE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SuperAdminLoginPage', () => {
  beforeEach(() => {
    loginMutate.mockReset();
    loginState = { isError: false, error: null, isPending: false };
    resetStore();
    window.sessionStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('submits credentials to the login mutation', () => {
    renderAt();
    fireEvent.change(screen.getByLabelText('login.email'), { target: { value: 'ops@kds.dev' } });
    fireEvent.change(screen.getByLabelText('login.password'), { target: { value: 'secret' } });
    fireEvent.submit(screen.getByRole('button', { name: 'login.signIn' }).closest('form')!);
    expect(loginMutate).toHaveBeenCalledWith({ email: 'ops@kds.dev', password: 'secret' });
  });

  it('redirects to the dashboard when already authenticated', () => {
    useSuperAdminAuthStore.setState({ isAuthenticated: true });
    renderAt();
    expect(screen.getByText('DASHBOARD-ROUTE')).toBeInTheDocument();
    expect(screen.queryByLabelText('login.email')).not.toBeInTheDocument();
  });

  it('redirects to /superadmin/2fa when a 2FA challenge is pending', () => {
    useSuperAdminAuthStore.setState({ requires2FA: true });
    renderAt();
    expect(screen.getByText('2FA-ROUTE')).toBeInTheDocument();
  });

  it('redirects to /superadmin/2fa when 2FA setup is required', () => {
    useSuperAdminAuthStore.setState({ requires2FASetup: true });
    renderAt();
    expect(screen.getByText('2FA-ROUTE')).toBeInTheDocument();
  });

  it('honors a stashed internal return path after authentication (deeplink)', () => {
    window.sessionStorage.setItem('superAdminPostLoginReturn', '/superadmin/tenants/abc');
    useSuperAdminAuthStore.setState({ isAuthenticated: true });
    renderAt();
    expect(screen.getByText('TENANT-DETAIL-ROUTE')).toBeInTheDocument();
    // the stashed value is consumed (one-shot read)
    expect(window.sessionStorage.getItem('superAdminPostLoginReturn')).toBeNull();
  });

  it('ignores an external/login-loop return path and falls back to the dashboard', () => {
    window.sessionStorage.setItem('superAdminPostLoginReturn', '/superadmin/login');
    useSuperAdminAuthStore.setState({ isAuthenticated: true });
    renderAt();
    expect(screen.getByText('DASHBOARD-ROUTE')).toBeInTheDocument();
  });

  it('renders the server error message when the login mutation errors', () => {
    loginState = {
      isError: true,
      error: axiosErrorWithMessage('Bad creds'),
      isPending: false,
    };
    renderAt();
    expect(screen.getByText('Bad creds')).toBeInTheDocument();
  });

  it('shows the pending label and disables submit while logging in', () => {
    loginState = { isError: false, error: null, isPending: true };
    renderAt();
    const btn = screen.getByRole('button', { name: 'login.signingIn' });
    expect(btn).toBeDisabled();
  });
});
