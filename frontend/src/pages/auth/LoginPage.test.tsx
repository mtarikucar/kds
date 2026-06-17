import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from './LoginPage';

// --- mocks --------------------------------------------------------------

const navigate = vi.fn();
let locationState: any = null;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useLocation: () => ({ state: locationState, pathname: '/login' }),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : key) }),
}));

// Bypass field-level zod validation: we exercise the submit/redirect logic,
// not the schema (the schema itself is trivial here). The resolver returns
// the supplied values with no errors so handleSubmit always invokes onSubmit.
vi.mock('@hookform/resolvers/zod', () => ({
  zodResolver: () => async (values: any) => ({ values, errors: {} }),
}));

// Auth store: isAuthenticated drives the post-login redirect effect.
let isAuthenticated = false;
vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ isAuthenticated }),
}));

const login = vi.fn();
const googleAuth = vi.fn();
vi.mock('../../features/auth/authApi', () => ({
  useLogin: () => ({ mutate: login, isPending: false }),
  useGoogleAuth: () => ({ mutate: googleAuth, isPending: false }),
}));


// Stub framer-motion: render the real underlying tag (motion.form → <form>,
// motion.div → <div>) so submit/click semantics survive, dropping only the
// animation props that the DOM doesn't understand.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        return ({ variants, initial, animate, whileHover, whileTap, ...props }: any) => {
          const Tag = tag as any;
          return <Tag {...props} />;
        };
      },
    },
  ),
}));
vi.mock('../../components/auth/AuthLayout', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));
// Plain inputs forward the RHF register props so the form submits with
// the default (empty) values we control, sidestepping the heavy field UI.
vi.mock('../../components/ui/Input', () => ({
  default: (props: any) => <input aria-label={props.label} {...props} />,
}));
vi.mock('../../components/ui/PasswordInput', () => ({
  default: (props: any) => <input aria-label={props.label} {...props} />,
}));
vi.mock('../../components/ui/Checkbox', () => ({
  default: (props: any) => <input type="checkbox" {...props} />,
}));
vi.mock('../../components/ui/SocialLoginButtons', () => ({
  default: ({ onGoogleSuccess, disabled }: any) => (
    <button
      type="button"
      data-testid="social-google"
      disabled={disabled}
      onClick={() => onGoogleSuccess('fake-id-token')}
    >
      Google
    </button>
  ),
}));
// Button: keep submit semantics, drop the spinner/styling.
vi.mock('../../components/ui/Button', () => ({
  default: ({ children, isLoading, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

function renderLogin() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isAuthenticated = false;
  locationState = null;
  window.sessionStorage.clear();
});

// handleSubmit runs the (mocked) async resolver, so the onSuccess→navigate
// only fires after a microtask flush — assert under waitFor.
async function submitAndExpectNavigate(expected: string) {
  login.mockImplementation((_data: any, opts: any) => opts.onSuccess());
  fireEvent.click(screen.getByRole('button', { name: 'auth:login.submit' }));
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith(expected, { replace: true }),
  );
}

describe('LoginPage post-login redirect target', () => {
  it('defaults to /dashboard when no return path is present', async () => {
    renderLogin();
    await submitAndExpectNavigate('/dashboard');
  });

  it('honours a safe internal path from location.state.from', async () => {
    locationState = { from: '/admin/store?sku=42' };
    renderLogin();
    await submitAndExpectNavigate('/admin/store?sku=42');
  });

  it('reads and clears the sessionStorage postLoginReturn one-shot', async () => {
    window.sessionStorage.setItem('postLoginReturn', '/orders');
    renderLogin();
    // One-shot: the key is removed on read so a later /login visit can't reuse it.
    expect(window.sessionStorage.getItem('postLoginReturn')).toBeNull();
    await submitAndExpectNavigate('/orders');
  });

  it('rejects a protocol-relative //evil.com target and falls back to /dashboard', async () => {
    locationState = { from: '//evil.com' };
    renderLogin();
    await submitAndExpectNavigate('/dashboard');
  });

  it('rejects a javascript: URI smuggled as a path', async () => {
    // The ':' in the path is rejected by the sanitizer regex.
    locationState = { from: '/javascript:alert(1)' };
    renderLogin();
    await submitAndExpectNavigate('/dashboard');
  });

  it('rejects a /login self-loop target', async () => {
    locationState = { from: '/login?next=x' };
    renderLogin();
    await submitAndExpectNavigate('/dashboard');
  });

  it('rejects an over-long (>=1024 char) target', async () => {
    locationState = { from: '/' + 'a'.repeat(1100) };
    renderLogin();
    await submitAndExpectNavigate('/dashboard');
  });
});

describe('LoginPage authenticated redirect effect', () => {
  it('redirects an already-authenticated visitor on mount', () => {
    isAuthenticated = true;
    locationState = { from: '/reports' };
    renderLogin();
    expect(navigate).toHaveBeenCalledWith('/reports', { replace: true });
  });
});

describe('LoginPage pending-approval banner', () => {
  it('shows the approval message from location.state when present', () => {
    locationState = { pendingApproval: true, message: 'Awaiting admin OK' };
    renderLogin();
    expect(screen.getByText('Awaiting admin OK')).toBeInTheDocument();
  });

  it('does not render the banner without a pendingApproval flag', () => {
    locationState = null;
    renderLogin();
    expect(screen.queryByText('auth:login.registrationSuccessful')).not.toBeInTheDocument();
  });
});

describe('LoginPage Google sign-in', () => {
  it('exchanges the Google ID token credential via googleAuth on success', () => {
    renderLogin();
    fireEvent.click(screen.getByTestId('social-google'));
    expect(googleAuth).toHaveBeenCalledWith('fake-id-token', expect.any(Object));
  });
});
