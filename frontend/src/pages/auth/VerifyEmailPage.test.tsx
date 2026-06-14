import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Specs for VerifyEmailPage — the 6-digit email verification form. Real
 * logic worth pinning: the code input strips non-digits and caps at 6
 * chars; submit is a no-op until a 6-digit code is present; a successful
 * verify flips to the success screen; a failed verify surfaces the
 * server message in an alert. The resend button only shows for
 * authenticated users. We mock the auth mutations + store + navigate.
 */

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fb?: any) => (typeof fb === 'string' ? fb : key) }),
}));

const verifyEmail = vi.fn();
const resendVerification = vi.fn();
vi.mock('../../features/auth/authApi', () => ({
  useVerifyEmail: () => ({ mutate: verifyEmail, isPending: false }),
  useResendVerificationEmail: () => ({ mutate: resendVerification, isPending: false }),
}));

let isAuthenticated = false;
let storedUser: any = null;
vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ isAuthenticated, user: storedUser }),
}));

import VerifyEmailPage from './VerifyEmailPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <VerifyEmailPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isAuthenticated = false;
  storedUser = null;
});

describe('VerifyEmailPage — code input sanitization', () => {
  it('strips non-digits and caps the code at 6 characters', () => {
    renderPage();
    const codeInput = screen.getByPlaceholderText('123456') as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: 'a1b2c3d4e5f6g7' } });
    expect(codeInput.value).toBe('123456');
  });
});

describe('VerifyEmailPage — submit guard', () => {
  it('does not call verifyEmail when the code is incomplete', () => {
    storedUser = { email: 'a@b.com' };
    renderPage();
    const codeInput = screen.getByPlaceholderText('123456');
    fireEvent.change(codeInput, { target: { value: '123' } });
    fireEvent.submit(codeInput.closest('form')!);
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it('calls verifyEmail with the email + 6-digit code on a valid submit', () => {
    storedUser = { email: 'a@b.com' };
    renderPage();
    const codeInput = screen.getByPlaceholderText('123456');
    fireEvent.change(codeInput, { target: { value: '654321' } });
    fireEvent.submit(codeInput.closest('form')!);

    expect(verifyEmail).toHaveBeenCalledWith(
      { email: 'a@b.com', code: '654321' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });
});

describe('VerifyEmailPage — verify outcomes', () => {
  it('shows the success screen when verification resolves', async () => {
    storedUser = { email: 'a@b.com' };
    verifyEmail.mockImplementation((_payload, opts) => opts.onSuccess());
    renderPage();
    const codeInput = screen.getByPlaceholderText('123456');
    fireEvent.change(codeInput, { target: { value: '111111' } });
    fireEvent.submit(codeInput.closest('form')!);

    await waitFor(() => expect(screen.getByText('verifyEmail.success')).toBeInTheDocument());
  });

  it('surfaces the server error message in an alert when verification fails', async () => {
    storedUser = { email: 'a@b.com' };
    verifyEmail.mockImplementation((_payload, opts) =>
      opts.onError({ response: { data: { message: 'code expired' } } }),
    );
    renderPage();
    const codeInput = screen.getByPlaceholderText('123456');
    fireEvent.change(codeInput, { target: { value: '222222' } });
    fireEvent.submit(codeInput.closest('form')!);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('code expired'));
  });
});

describe('VerifyEmailPage — resend visibility', () => {
  it('hides the resend button for unauthenticated visitors', () => {
    isAuthenticated = false;
    renderPage();
    expect(screen.queryByText('verifyEmail.resendEmail')).toBeNull();
  });

  it('shows + wires the resend button for authenticated users', () => {
    isAuthenticated = true;
    storedUser = { email: 'a@b.com' };
    renderPage();
    const resendBtn = screen.getByText('verifyEmail.resendEmail');
    fireEvent.click(resendBtn);
    expect(resendVerification).toHaveBeenCalledTimes(1);
  });
});
