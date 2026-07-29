import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forwardRef } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RegisterPage from './RegisterPage';
import { UserRole } from '../../types';

/**
 * Validation-path specs for RegisterPage — unlike RegisterPage.test.tsx these
 * run the REAL zod resolver, because the bugs under guard lived inside the
 * schema itself:
 *
 *  - review F5: the "restaurant required" refine attached its error to
 *    ['restaurantName'], a field that is not rendered for staff roles — a
 *    staff submit with no tenant silently did nothing. The error must land on
 *    ['tenantId'] (the select staff actually see).
 *  - review F7: the FE schema only enforced min(8) while the backend requires
 *    lower+upper+digit — a "valid" form died on an untranslated English
 *    class-validator message. The FE regex must mirror the backend rule.
 */

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

const registerUser = vi.fn();
const googleAuth = vi.fn();
vi.mock('../../features/auth/authApi', () => ({
  useRegister: () => ({ mutate: registerUser, isPending: false }),
  useGoogleAuth: () => ({ mutate: googleAuth, isPending: false }),
}));

vi.mock('../../api/tenantsApi', () => ({
  useGetPublicTenants: () => ({
    data: [
      { id: 't1', name: 'Pizza Place' },
      { id: 't2', name: 'Burger Joint' },
    ],
    isLoading: false,
  }),
}));

vi.mock('@react-oauth/google', () => ({ useGoogleLogin: () => vi.fn() }));

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
vi.mock('../../components/ui/PasswordStrength', () => ({ default: () => null }));
vi.mock('../../components/ui/SocialLoginButtons', () => ({ default: () => null }));
// Inputs/selects forwardRef (RHF registration) AND render their error prop so
// the tests can assert WHERE a validation message actually surfaces.
vi.mock('../../components/ui/Input', () => ({
  default: forwardRef(({ label, error, ...props }: any, ref: any) => (
    <div>
      <input ref={ref} aria-label={label} {...props} />
      {error ? <div role="alert">{error}</div> : null}
    </div>
  )),
}));
vi.mock('../../components/ui/PasswordInput', () => ({
  default: forwardRef(({ label, error, ...props }: any, ref: any) => (
    <div>
      <input ref={ref} aria-label={label} {...props} />
      {error ? <div role="alert">{error}</div> : null}
    </div>
  )),
}));
vi.mock('../../components/ui/PhoneInput', () => ({
  default: ({ label, value, onChange, error }: any) => (
    <div>
      <input
        aria-label={label}
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
      />
      {error ? <div role="alert">{error}</div> : null}
    </div>
  ),
}));
vi.mock('../../components/ui/FormSelect', () => ({
  default: forwardRef(({ label, options, error, ...props }: any, ref: any) => (
    <div>
      <select ref={ref} aria-label={label} {...props}>
        <option value="">—</option>
        {options?.map((o: any) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? <div role="alert">{error}</div> : null}
    </div>
  )),
}));
vi.mock('../../components/ui/Checkbox', () => ({
  default: ({ label, ...props }: any) => <input type="checkbox" aria-label="terms" {...props} />,
}));
vi.mock('../../components/ui/Button', () => ({
  default: ({ children, isLoading, ...props }: any) => <button {...props}>{children}</button>,
}));

function renderRegister() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fillCommonFields(password = 'Password1') {
  fireEvent.change(screen.getByLabelText('auth:register.email'), {
    target: { value: 'person@x.com' },
  });
  fireEvent.change(screen.getByLabelText('auth:register.password'), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText('auth:register.firstName'), {
    target: { value: 'Ann' },
  });
  fireEvent.change(screen.getByLabelText('auth:register.lastName'), {
    target: { value: 'Person' },
  });
  fireEvent.change(screen.getByLabelText('Telefon'), {
    target: { value: '+905551234567' },
  });
  fireEvent.click(screen.getByLabelText('terms'));
}

beforeEach(() => vi.clearAllMocks());

describe('RegisterPage staff tenant validation (review F5)', () => {
  it('shows the role-required error ON THE TENANT SELECT for a staff role with no restaurant chosen', async () => {
    renderRegister();
    fireEvent.change(screen.getByLabelText('auth:register.role'), {
      target: { value: UserRole.WAITER },
    });
    fillCommonFields();
    fireEvent.click(screen.getByRole('button', { name: 'auth:register.submit' }));

    // Not a silent no-op anymore: the submit is blocked AND the message is
    // visible next to the field the staff user actually sees.
    await waitFor(() =>
      expect(screen.getByText('auth:register.roleRequired')).toBeInTheDocument(),
    );
    expect(registerUser).not.toHaveBeenCalled();
    // The error sits inside the tenant select's wrapper, not a phantom
    // restaurant-name field.
    const select = screen.getByLabelText('auth:register.selectRestaurant');
    expect(select.parentElement?.textContent).toContain('auth:register.roleRequired');
  });

  it('submits cleanly once the staff user picks a restaurant', async () => {
    renderRegister();
    fireEvent.change(screen.getByLabelText('auth:register.role'), {
      target: { value: UserRole.WAITER },
    });
    fillCommonFields();
    fireEvent.change(screen.getByLabelText('auth:register.selectRestaurant'), {
      target: { value: 't2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth:register.submit' }));

    await waitFor(() => expect(registerUser).toHaveBeenCalledTimes(1));
    expect(registerUser.mock.calls[0][0].tenantId).toBe('t2');
  });

  it('still attaches the error to the restaurant-name input for the ADMIN role', async () => {
    renderRegister();
    fillCommonFields(); // default role: ADMIN, restaurantName left empty
    fireEvent.click(screen.getByRole('button', { name: 'auth:register.submit' }));

    await waitFor(() =>
      expect(screen.getByText('auth:register.roleRequired')).toBeInTheDocument(),
    );
    expect(registerUser).not.toHaveBeenCalled();
    const nameInput = screen.getByLabelText('auth:register.restaurantName');
    expect(nameInput.parentElement?.textContent).toContain('auth:register.roleRequired');
  });
});

describe('RegisterPage password complexity (review F7)', () => {
  it.each(['alllowercase1', 'ALLUPPERCASE1', 'NoDigitsHere'])(
    'rejects "%s" client-side with the localized complexity message (backend parity)',
    async (badPassword) => {
      renderRegister();
      fillCommonFields(badPassword);
      fireEvent.change(screen.getByLabelText('auth:register.restaurantName'), {
        target: { value: 'My Diner' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'auth:register.submit' }));

      await waitFor(() =>
        expect(
          screen.getByText(
            'Password must contain at least 8 characters, including uppercase, lowercase, and numbers',
          ),
        ).toBeInTheDocument(),
      );
      expect(registerUser).not.toHaveBeenCalled();
    },
  );

  it('accepts a password meeting the backend rule (lower+upper+digit)', async () => {
    renderRegister();
    fillCommonFields('Password1');
    fireEvent.change(screen.getByLabelText('auth:register.restaurantName'), {
      target: { value: 'My Diner' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth:register.submit' }));

    await waitFor(() => expect(registerUser).toHaveBeenCalledTimes(1));
  });
});
