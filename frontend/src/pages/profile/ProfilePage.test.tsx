import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forwardRef } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProfilePage from './ProfilePage';

// --- mocks --------------------------------------------------------------

const navigate = vi.fn();
let params: Record<string, string> = {};
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useSearchParams: () => [{ get: (k: string) => params[k] ?? null }],
  };
});

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@hookform/resolvers/zod', () => ({
  zodResolver: () => async (values: any) => ({ values, errors: {} }),
}));

let profileData: any = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@x.com',
  phone: '+905551234567',
  role: 'ADMIN',
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  tenant: { name: 'Diner', subdomain: 'diner' },
};
let profileLoading = false;
const updateProfile = vi.fn();
const changePassword = vi.fn();
vi.mock('../../features/users/usersApi', () => ({
  useMyProfile: () => ({ data: profileData, isLoading: profileLoading }),
  useUpdateProfile: () => ({ mutate: updateProfile, isPending: false }),
}));
vi.mock('../../features/auth/authApi', () => ({
  useChangePassword: () => ({ mutate: changePassword, isPending: false }),
}));

vi.mock('../../components/EmailVerificationCard', () => ({
  EmailVerificationCard: () => <div data-testid="email-verif-card" />,
}));
vi.mock('../../components/ui/Input', () => ({
  default: forwardRef(({ label, hint, ...props }: any, ref: any) => (
    <input ref={ref} aria-label={label} {...props} />
  )),
}));
vi.mock('../../components/ui/Button', () => ({
  default: ({ children, isLoading, ...props }: any) => <button {...props}>{children}</button>,
}));

function renderPage() {
  render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  params = {};
  profileLoading = false;
  profileData = {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@x.com',
    phone: '+905551234567',
    role: 'ADMIN',
    emailVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    tenant: { name: 'Diner', subdomain: 'diner' },
  };
});

describe('ProfilePage loading', () => {
  it('renders a loading indicator while the profile is fetching', () => {
    profileLoading = true;
    profileData = undefined;
    renderPage();
    expect(screen.getByText('common:app.loading')).toBeInTheDocument();
  });
});

describe('ProfilePage phone-required banner', () => {
  it('shows the phone-required banner when reason=phone-required', () => {
    params = { reason: 'phone-required' };
    renderPage();
    expect(screen.getByText('Telefon numarası gerekli')).toBeInTheDocument();
  });

  it('does not show the banner for an unrelated reason', () => {
    params = { reason: 'something-else' };
    renderPage();
    expect(screen.queryByText('Telefon numarası gerekli')).not.toBeInTheDocument();
  });
});

describe('ProfilePage save → returnTo redirect (open-redirect guard)', () => {
  it('redirects to a relative returnTo after a successful save', async () => {
    params = { returnTo: '/checkout/pay' };
    updateProfile.mockImplementation((_d: any, opts: any) => opts.onSuccess());
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'common:app.save' }));
    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith('/checkout/pay', { replace: true });
  });

  it('ignores a non-relative (absolute URL) returnTo and does not redirect', async () => {
    // returnTo must start with '/' — an http(s) URL is rejected as an
    // open-redirect vector, so no navigate fires after save.
    params = { returnTo: 'https://evil.com' };
    updateProfile.mockImplementation((_d: any, opts: any) => opts.onSuccess());
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'common:app.save' }));
    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('stays on the page (no redirect) when there is no returnTo', async () => {
    updateProfile.mockImplementation((_d: any, opts: any) => opts.onSuccess());
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'common:app.save' }));
    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('ProfilePage password change', () => {
  it('forwards current+new password (dropping confirm) to the change-password mutation', async () => {
    changePassword.mockImplementation(() => {});
    renderPage();

    fireEvent.change(screen.getByLabelText('profile.currentPassword'), {
      target: { value: 'oldpass12' },
    });
    fireEvent.change(screen.getByLabelText('profile.newPassword'), {
      target: { value: 'newpass12' },
    });
    fireEvent.change(screen.getByLabelText('profile.confirmNewPassword'), {
      target: { value: 'newpass12' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'profile.changePassword' }));

    await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(1));
    // confirmPassword is intentionally not forwarded to the API.
    expect(changePassword.mock.calls[0][0]).toEqual({
      currentPassword: 'oldpass12',
      newPassword: 'newpass12',
    });
  });
});

describe('ProfilePage email verification card', () => {
  it('renders the verification card only when the email is unverified', () => {
    profileData = { ...profileData, emailVerified: false };
    renderPage();
    expect(screen.getByTestId('email-verif-card')).toBeInTheDocument();
  });

  it('hides the verification card when the email is verified', () => {
    profileData = { ...profileData, emailVerified: true };
    renderPage();
    expect(screen.queryByTestId('email-verif-card')).not.toBeInTheDocument();
  });
});
