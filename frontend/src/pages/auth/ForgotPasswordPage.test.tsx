import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forwardRef } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ForgotPasswordPage from './ForgotPasswordPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@hookform/resolvers/zod', () => ({
  zodResolver: () => async (values: any) => ({ values, errors: {} }),
}));

const forgotPassword = vi.fn();
vi.mock('../../features/auth/authApi', () => ({
  useForgotPassword: () => ({ mutate: forgotPassword, isPending: false }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_t, tag: string) => ({ variants, initial, animate, whileHover, whileTap, ...props }: any) => {
        const Tag = tag as any;
        return <Tag {...props} />;
      },
    },
  ),
}));
vi.mock('../../components/auth/AuthLayout', () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock('../../components/ui/Input', () => ({
  default: forwardRef((props: any, ref: any) => <input ref={ref} aria-label={props.label} {...props} />),
}));
vi.mock('../../components/ui/Button', () => ({
  default: ({ children, isLoading, ...props }: any) => <button {...props}>{children}</button>,
}));

function renderPage() {
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('ForgotPasswordPage', () => {
  it('submits the typed email to the forgot-password mutation', async () => {
    forgotPassword.mockImplementation(() => {});
    renderPage();
    fireEvent.change(screen.getByLabelText('auth:forgotPassword.email'), {
      target: { value: 'me@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth:forgotPassword.submit' }));

    await waitFor(() => expect(forgotPassword).toHaveBeenCalledTimes(1));
    // The hook receives the raw email string (not the form object).
    expect(forgotPassword.mock.calls[0][0]).toBe('me@example.com');
  });

  it('swaps to the check-email confirmation screen only after a successful send', async () => {
    forgotPassword.mockImplementation((_email: string, opts: any) => opts.onSuccess());
    renderPage();

    // Before submit: the form is shown, confirmation is not.
    expect(screen.queryByText('auth:forgotPassword.checkEmail')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('auth:forgotPassword.email'), {
      target: { value: 'me@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth:forgotPassword.submit' }));

    await waitFor(() =>
      expect(screen.getByText('auth:forgotPassword.checkEmail')).toBeInTheDocument(),
    );
    // Form input is gone once confirmation shows.
    expect(screen.queryByLabelText('auth:forgotPassword.email')).not.toBeInTheDocument();
  });

  it('stays on the form when the send fails (no onSuccess)', async () => {
    forgotPassword.mockImplementation(() => {}); // never calls onSuccess
    renderPage();
    fireEvent.change(screen.getByLabelText('auth:forgotPassword.email'), {
      target: { value: 'me@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth:forgotPassword.submit' }));

    await waitFor(() => expect(forgotPassword).toHaveBeenCalled());
    expect(screen.queryByText('auth:forgotPassword.checkEmail')).not.toBeInTheDocument();
    expect(screen.getByLabelText('auth:forgotPassword.email')).toBeInTheDocument();
  });
});
