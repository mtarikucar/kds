import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SuperAdminSettingsPage from './SuperAdminSettingsPage';
import { useSuperAdminAuthStore } from '../../store/superAdminAuthStore';

const fetchSetup = vi.fn();
const enableMutate = vi.fn();
let setupLoading = false;
let enableState: any;

vi.mock('../../features/superadmin/api/superAdminApi', () => ({
  useSetup2FA: () => ({ refetch: fetchSetup, isLoading: setupLoading }),
  useEnable2FA: () => ({ mutate: enableMutate, ...enableState }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// getApiErrorMessage imports i18n/config, which would eagerly re-init i18next
// against the partial react-i18next mock. Stub it.
vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));

function setAdmin(over: Partial<any> = {}) {
  useSuperAdminAuthStore.setState({
    superAdmin: {
      id: 'sa1',
      email: 'ops@kds.dev',
      firstName: 'Op',
      lastName: 'Erator',
      status: 'ACTIVE',
      twoFactorEnabled: false,
      ...over,
    } as any,
    isAuthenticated: true,
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SuperAdminSettingsPage />
    </QueryClientProvider>,
  );
}

describe('SuperAdminSettingsPage', () => {
  beforeEach(() => {
    fetchSetup.mockReset();
    enableMutate.mockReset();
    setupLoading = false;
    enableState = { isPending: false, isError: false, error: null };
    setAdmin();
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders the profile details from the auth store', () => {
    renderPage();
    expect(screen.getByText('ops@kds.dev')).toBeInTheDocument();
    expect(screen.getByText('Op Erator')).toBeInTheDocument();
    expect(screen.getByText('settings.twoFactorDisabled')).toBeInTheDocument();
  });

  it('hides the Setup-2FA button when 2FA is already enabled', () => {
    setAdmin({ twoFactorEnabled: true });
    renderPage();
    expect(screen.queryByRole('button', { name: 'settings.setup2fa' })).not.toBeInTheDocument();
    expect(screen.getByText('settings.twoFactorEnabled')).toBeInTheDocument();
  });

  it('fetches the setup payload and opens the QR modal on success', async () => {
    fetchSetup.mockResolvedValue({ data: { secret: 'SECRET32', qrCodeUrl: 'data:image/png;base64,zzz' } });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'settings.setup2fa' }));
    expect(fetchSetup).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('settings.setupModalTitle')).toBeInTheDocument();
    expect(screen.getByText('SECRET32')).toBeInTheDocument();
  });

  it('does NOT open the modal when the setup fetch returns no data', async () => {
    fetchSetup.mockResolvedValue({ data: undefined });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'settings.setup2fa' }));
    // give the awaited handler a microtask to settle
    await Promise.resolve();
    expect(screen.queryByText('settings.setupModalTitle')).not.toBeInTheDocument();
  });

  it('enables 2FA with the entered code and alerts on success', async () => {
    fetchSetup.mockResolvedValue({ data: { secret: 'SECRET32', qrCodeUrl: 'data:image/png;base64,zzz' } });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    // enable mutate: call onSuccess synchronously
    enableMutate.mockImplementation((_code: string, opts: any) => opts.onSuccess());
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'settings.setup2fa' }));
    await screen.findByText('settings.setupModalTitle');

    const codeInput = screen.getByPlaceholderText('000000') as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.enable2fa' }));

    expect(enableMutate.mock.calls[0][0]).toBe('123456');
    expect(alertSpy).toHaveBeenCalledWith('settings.enabledSuccess');
    // modal closes after success
    expect(screen.queryByText('settings.setupModalTitle')).not.toBeInTheDocument();
  });

  it('keeps Enable disabled until the code is 6 digits', async () => {
    fetchSetup.mockResolvedValue({ data: { secret: 'SECRET32', qrCodeUrl: 'data:image/png;base64,zzz' } });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'settings.setup2fa' }));
    await screen.findByText('settings.setupModalTitle');
    const enableBtn = screen.getByRole('button', { name: 'settings.enable2fa' });
    expect(enableBtn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } });
    expect(screen.getByRole('button', { name: 'settings.enable2fa' })).not.toBeDisabled();
  });

  it('shows a loading label on the Setup button while the query is fetching', () => {
    setupLoading = true;
    renderPage();
    const btn = screen.getByRole('button', { name: 'settings.setup2faLoading' });
    expect(btn).toBeDisabled();
  });
});
