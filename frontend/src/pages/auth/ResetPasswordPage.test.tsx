import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { forwardRef } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ResetPasswordPage from './ResetPasswordPage';

// --- mocks --------------------------------------------------------------

const navigate = vi.fn();
let token: string | null = 'tok-123';
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useSearchParams: () => [{ get: (k: string) => (k === 'token' ? token : null) }],
  };
});

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@hookform/resolvers/zod', () => ({
  zodResolver: () => async (values: any) => ({ values, errors: {} }),
}));

const resetPassword = vi.fn();
vi.mock('../../features/auth/authApi', () => ({
  useResetPassword: () => ({ mutate: resetPassword, isPending: false }),
}));

vi.mock('../../components/ui/Input', () => ({
  default: forwardRef((props: any, ref: any) => <input ref={ref} aria-label={props.label} {...props} />),
}));
vi.mock('../../components/ui/Button', () => ({
  default: ({ children, isLoading, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('../../components/ui/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
}));

function renderPage() {
  render(
    <MemoryRouter>
      <ResetPasswordPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  token = 'tok-123';
});
afterEach(() => vi.useRealTimers());

describe('ResetPasswordPage token gating', () => {
  it('redirects to /forgot-password and renders nothing when no token is present', () => {
    token = null;
    const { container } = render(
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>,
    );
    expect(navigate).toHaveBeenCalledWith('/forgot-password');
    // Body collapses to null (no form) once the token is missing.
    expect(container.querySelector('form')).toBeNull();
  });

  it('renders the reset form when a token is present', () => {
    renderPage();
    expect(screen.getByLabelText('auth:resetPassword.newPassword')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('ResetPasswordPage submit', () => {
  it('sends the token and new password to the mutation', async () => {
    resetPassword.mockImplementation(() => {});
    renderPage();
    fireEvent.change(screen.getByLabelText('auth:resetPassword.newPassword'), {
      target: { value: 'newpass12' },
    });
    fireEvent.change(screen.getByLabelText('auth:resetPassword.confirmPassword'), {
      target: { value: 'newpass12' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth:resetPassword.submit' }));

    await waitFor(() => expect(resetPassword).toHaveBeenCalledTimes(1));
    expect(resetPassword.mock.calls[0][0]).toEqual({ token: 'tok-123', newPassword: 'newpass12' });
  });

  it('shows the success screen and schedules a redirect to /login after 3s', async () => {
    vi.useFakeTimers();
    resetPassword.mockImplementation((_data: any, opts: any) => opts.onSuccess());
    renderPage();

    fireEvent.change(screen.getByLabelText('auth:resetPassword.newPassword'), {
      target: { value: 'newpass12' },
    });
    fireEvent.change(screen.getByLabelText('auth:resetPassword.confirmPassword'), {
      target: { value: 'newpass12' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'auth:resetPassword.submit' }));
    });

    // Success state replaces the form.
    expect(screen.getByText('auth:resetPassword.passwordReset')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();

    // After the 3s timer the user is sent to /login.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
