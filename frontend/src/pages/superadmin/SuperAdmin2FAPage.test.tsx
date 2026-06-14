import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SuperAdmin2FAPage from './SuperAdmin2FAPage';
import { useSuperAdminAuthStore } from '../../store/superAdminAuthStore';

const verifyMutate = vi.fn();
const setupMutate = vi.fn();
const enableMutate = vi.fn();
let verifyState: any;
let setupState: any;
let enableState: any;

vi.mock('../../features/superadmin/api/superAdminApi', () => ({
  useVerify2FA: () => ({ mutate: verifyMutate, ...verifyState }),
  useSetup2FAWithToken: () => ({ mutate: setupMutate, ...setupState }),
  useEnable2FAWithToken: () => ({ mutate: enableMutate, ...enableState }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

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

function renderAt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/superadmin/2fa']}>
        <Routes>
          <Route path="/superadmin/2fa" element={<SuperAdmin2FAPage />} />
          <Route path="/superadmin/login" element={<div>LOGIN-ROUTE</div>} />
          <Route path="/superadmin/dashboard" element={<div>DASHBOARD-ROUTE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fillCode(value: string) {
  fireEvent.change(screen.getByLabelText('twoFactor.verificationCode'), { target: { value } });
}

describe('SuperAdmin2FAPage — guards', () => {
  beforeEach(() => {
    verifyMutate.mockReset();
    setupMutate.mockReset();
    enableMutate.mockReset();
    verifyState = { isPending: false, error: null };
    setupState = { isPending: false, error: null };
    enableState = { isPending: false, error: null };
    resetStore();
  });
  afterEach(() => vi.restoreAllMocks());

  it('redirects to /superadmin/login when neither 2FA nor setup is required', () => {
    renderAt();
    expect(screen.getByText('LOGIN-ROUTE')).toBeInTheDocument();
  });

  it('redirects to /superadmin/login when there is no tempToken', () => {
    useSuperAdminAuthStore.setState({ requires2FA: true, tempToken: null });
    renderAt();
    expect(screen.getByText('LOGIN-ROUTE')).toBeInTheDocument();
  });

  it('redirects to the dashboard when fully authenticated', () => {
    useSuperAdminAuthStore.setState({
      isAuthenticated: true,
      requires2FA: false,
      requires2FASetup: false,
      tempToken: 'tt',
    });
    renderAt();
    expect(screen.getByText('DASHBOARD-ROUTE')).toBeInTheDocument();
  });
});

describe('SuperAdmin2FAPage — verify mode', () => {
  beforeEach(() => {
    verifyMutate.mockReset();
    enableMutate.mockReset();
    setupMutate.mockReset();
    verifyState = { isPending: false, error: null };
    setupState = { isPending: false, error: null };
    enableState = { isPending: false, error: null };
    resetStore();
    useSuperAdminAuthStore.setState({ requires2FA: true, tempToken: 'temp-123' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('does NOT auto-fire setup when only verification is required', () => {
    renderAt();
    expect(setupMutate).not.toHaveBeenCalled();
    expect(screen.getByText('twoFactor.verifyTitle')).toBeInTheDocument();
  });

  it('verifies with { tempToken, code } on submit of a 6-digit code', () => {
    renderAt();
    fillCode('123456');
    fireEvent.submit(screen.getByLabelText('twoFactor.verificationCode').closest('form')!);
    expect(verifyMutate).toHaveBeenCalledWith({ tempToken: 'temp-123', code: '123456' });
    expect(enableMutate).not.toHaveBeenCalled();
  });

  it('strips non-digits from the code input', () => {
    renderAt();
    const input = screen.getByLabelText('twoFactor.verificationCode') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12ab34' } });
    expect(input.value).toBe('1234');
  });

  it('keeps Verify disabled until exactly 6 digits are entered', () => {
    renderAt();
    const verifyBtn = screen.getByRole('button', { name: 'twoFactor.verify' });
    expect(verifyBtn).toBeDisabled();
    fillCode('123456');
    expect(screen.getByRole('button', { name: 'twoFactor.verify' })).not.toBeDisabled();
  });

  it('Cancel logs the operator out (clears tempToken + requires2FA)', () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'twoFactor.cancel' }));
    const s = useSuperAdminAuthStore.getState();
    expect(s.tempToken).toBeNull();
    expect(s.requires2FA).toBe(false);
  });

  it('surfaces the verification error message', () => {
    verifyState = { isPending: false, error: { response: { data: { message: 'Wrong code' } } } };
    renderAt();
    expect(screen.getByText('Wrong code')).toBeInTheDocument();
  });
});

describe('SuperAdmin2FAPage — setup mode (auto-fire)', () => {
  beforeEach(() => {
    verifyMutate.mockReset();
    enableMutate.mockReset();
    setupMutate.mockReset();
    verifyState = { isPending: false, error: null };
    setupState = { isPending: false, error: null };
    enableState = { isPending: false, error: null };
    resetStore();
    useSuperAdminAuthStore.setState({ requires2FASetup: true, tempToken: 'temp-setup' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('auto-fires the setup mutation with the tempToken on mount', () => {
    renderAt();
    expect(setupMutate).toHaveBeenCalledTimes(1);
    expect(setupMutate.mock.calls[0][0]).toBe('temp-setup');
    expect(screen.getByText('twoFactor.setupTitle')).toBeInTheDocument();
  });

  it('renders the QR + secret once setup resolves, then enable() on submit', () => {
    // Make setup resolve synchronously into the onSuccess callback.
    setupMutate.mockImplementation((_token: string, opts: any) => {
      opts.onSuccess({ secret: 'BASE32SECRET', qrCodeUrl: 'data:image/png;base64,xxx' });
    });
    renderAt();
    expect(screen.getByText('BASE32SECRET')).toBeInTheDocument();
    expect(screen.getByAltText('twoFactor.qrAlt')).toBeInTheDocument();

    fillCode('654321');
    fireEvent.submit(screen.getByLabelText('twoFactor.verificationCode').closest('form')!);
    expect(enableMutate).toHaveBeenCalledWith({ tempToken: 'temp-setup', code: '654321' });
    expect(verifyMutate).not.toHaveBeenCalled();
  });
});
