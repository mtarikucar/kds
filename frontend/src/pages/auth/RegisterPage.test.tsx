import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forwardRef } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RegisterPage from './RegisterPage';
import { UserRole } from '../../types';

// --- mocks --------------------------------------------------------------

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : key) }),
}));

// Bypass field validation — the role-conditional refine is exercised via the
// payload-shaping branches in onSubmit, which we drive directly.
vi.mock('@hookform/resolvers/zod', () => ({
  zodResolver: () => async (values: any) => ({ values, errors: {} }),
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
// Inputs/selects must forwardRef so RHF's register ref reaches the DOM node
// and the typed values land in the submitted payload.
vi.mock('../../components/ui/Input', () => ({
  default: forwardRef((props: any, ref: any) => <input ref={ref} aria-label={props.label} {...props} />),
}));
vi.mock('../../components/ui/PasswordInput', () => ({
  default: forwardRef((props: any, ref: any) => <input ref={ref} aria-label={props.label} {...props} />),
}));
vi.mock('../../components/ui/FormSelect', () => ({
  default: forwardRef(({ label, options, ...props }: any, ref: any) => (
    <select ref={ref} aria-label={label} {...props}>
      {options?.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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

beforeEach(() => vi.clearAllMocks());

describe('RegisterPage submit gating', () => {
  it('does not submit while terms are unchecked (button disabled, no mutation)', async () => {
    renderRegister();
    const submit = screen.getByRole('button', { name: 'auth:register.submit' });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    await new Promise((r) => setTimeout(r, 0));
    expect(registerUser).not.toHaveBeenCalled();
  });
});

describe('RegisterPage payload shaping by role', () => {
  it('sends restaurantName (not tenantId) for the ADMIN role', async () => {
    renderRegister();
    // Default role is ADMIN — fill restaurant name, accept terms, submit.
    fireEvent.change(screen.getByLabelText('auth:register.email'), {
      target: { value: 'owner@x.com' },
    });
    fireEvent.change(screen.getByLabelText('auth:register.password'), {
      target: { value: 'password1' },
    });
    fireEvent.change(screen.getByLabelText('auth:register.firstName'), {
      target: { value: 'Ann' },
    });
    fireEvent.change(screen.getByLabelText('auth:register.lastName'), {
      target: { value: 'Owner' },
    });
    fireEvent.change(screen.getByLabelText('auth:register.restaurantName'), {
      target: { value: 'My Diner' },
    });
    fireEvent.click(screen.getByLabelText('terms'));
    fireEvent.click(screen.getByRole('button', { name: 'auth:register.submit' }));

    await waitFor(() => expect(registerUser).toHaveBeenCalledTimes(1));
    const payload = registerUser.mock.calls[0][0];
    expect(payload.restaurantName).toBe('My Diner');
    expect(payload.tenantId).toBeUndefined();
    expect(payload.role).toBe(UserRole.ADMIN);
  });

  it('sends tenantId (not restaurantName) for a non-admin role', async () => {
    renderRegister();
    // Switch role to WAITER → restaurant select replaces the name input.
    fireEvent.change(screen.getByLabelText('auth:register.role'), {
      target: { value: UserRole.WAITER },
    });
    fireEvent.change(screen.getByLabelText('auth:register.email'), {
      target: { value: 'staff@x.com' },
    });
    fireEvent.change(screen.getByLabelText('auth:register.password'), {
      target: { value: 'password1' },
    });
    fireEvent.change(screen.getByLabelText('auth:register.firstName'), {
      target: { value: 'Sam' },
    });
    fireEvent.change(screen.getByLabelText('auth:register.lastName'), {
      target: { value: 'Staff' },
    });
    fireEvent.change(screen.getByLabelText('auth:register.selectRestaurant'), {
      target: { value: 't2' },
    });
    fireEvent.click(screen.getByLabelText('terms'));
    fireEvent.click(screen.getByRole('button', { name: 'auth:register.submit' }));

    await waitFor(() => expect(registerUser).toHaveBeenCalledTimes(1));
    const payload = registerUser.mock.calls[0][0];
    expect(payload.tenantId).toBe('t2');
    expect(payload.restaurantName).toBeUndefined();
    expect(payload.role).toBe(UserRole.WAITER);
  });
});

describe('RegisterPage country selector', () => {
  async function fillRequiredFieldsExceptPhoneAndCountry() {
    fireEvent.change(screen.getByLabelText('auth:register.email'), {
      target: { value: 'owner@x.com' },
    });
    fireEvent.change(screen.getByLabelText('auth:register.password'), {
      target: { value: 'password1' },
    });
    fireEvent.change(screen.getByLabelText('auth:register.firstName'), {
      target: { value: 'Ann' },
    });
    fireEvent.change(screen.getByLabelText('auth:register.lastName'), {
      target: { value: 'Owner' },
    });
    fireEvent.change(screen.getByLabelText('auth:register.restaurantName'), {
      target: { value: 'My Diner' },
    });
  }

  async function submit() {
    fireEvent.click(screen.getByLabelText('terms'));
    fireEvent.click(screen.getByRole('button', { name: 'auth:register.submit' }));
    await waitFor(() => expect(registerUser).toHaveBeenCalledTimes(1));
    return registerUser.mock.calls[0][0];
  }

  it('offers ONLY the platform-supported countries (TR, UZ) — never a full ISO list', () => {
    renderRegister();
    const select = screen.getByLabelText('auth:register.country') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['TR', 'UZ']);
  });

  it('defaults to TR before any phone/country interaction', async () => {
    renderRegister();
    await fillRequiredFieldsExceptPhoneAndCountry();
    const payload = await submit();
    expect(payload.countryCode).toBe('TR');
  });

  it("pre-fills the country from the phone's E.164 region (a +998 number suggests UZ)", async () => {
    renderRegister();
    await fillRequiredFieldsExceptPhoneAndCountry();
    // "Telefon" is PhoneInput's label fallback (auth:register.phone, 'Telefon').
    fireEvent.change(screen.getByLabelText('Telefon'), {
      target: { value: '+998901234567' },
    });
    const payload = await submit();
    expect(payload.countryCode).toBe('UZ');
    expect(payload.phone).toBe('+998901234567');
  });

  it("the operator's own country choice wins and is NOT silently overwritten by a later phone edit", async () => {
    renderRegister();
    await fillRequiredFieldsExceptPhoneAndCountry();

    // Operator manually picks UZ first.
    fireEvent.change(screen.getByLabelText('auth:register.country'), {
      target: { value: 'UZ' },
    });

    // Then types a Turkish phone number — must NOT silently flip the
    // country back to TR. Pre-fill is a suggestion; the operator's
    // explicit choice wins once made.
    fireEvent.change(screen.getByLabelText('Telefon'), {
      target: { value: '+905551234567' },
    });

    const payload = await submit();
    expect(payload.countryCode).toBe('UZ');
    expect(payload.phone).toBe('+905551234567');
  });
});

describe('RegisterPage post-register navigation', () => {
  async function submitAdmin() {
    fireEvent.change(screen.getByLabelText('auth:register.restaurantName'), {
      target: { value: 'My Diner' },
    });
    fireEvent.click(screen.getByLabelText('terms'));
    fireEvent.click(screen.getByRole('button', { name: 'auth:register.submit' }));
    await waitFor(() => expect(registerUser).toHaveBeenCalled());
  }

  it('routes to /login with pendingApproval state when the API flags approval', async () => {
    registerUser.mockImplementation((_p: any, opts: any) =>
      opts.onSuccess({ pendingApproval: true, message: 'Wait for admin' }),
    );
    renderRegister();
    await submitAdmin();
    expect(navigate).toHaveBeenCalledWith('/login', {
      state: { pendingApproval: true, message: 'Wait for admin' },
    });
  });

  it('routes to plain /login when no approval is pending', async () => {
    registerUser.mockImplementation((_p: any, opts: any) => opts.onSuccess({}));
    renderRegister();
    await submitAdmin();
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
