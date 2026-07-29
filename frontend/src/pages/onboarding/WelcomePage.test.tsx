import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forwardRef } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WelcomePage from './WelcomePage';

/**
 * Role-aware /welcome form (review F1b). Business name / tax / address /
 * timezone are TENANT-scoped: only an ADMIN may see or submit them. A staff
 * user visiting /welcome directly must get a submittable form with only the
 * user-scoped fields (no required-but-hidden businessName trap), and the
 * submit payload must not carry tenant fields at all.
 *
 * Runs the REAL zod resolver — the required/optional split lives in the
 * schema.
 */

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'tr', changeLanguage: vi.fn() },
  }),
}));

let mockProfile: any;
const complete = vi.fn();
const logout = vi.fn();
vi.mock('../../features/auth/authApi', () => ({
  useProfile: () => ({ data: mockProfile }),
  useCompleteProfile: () => ({ mutate: complete, isPending: false }),
  useLogout: () => ({ mutate: logout }),
}));

vi.mock('../../components/ui/Input', () => ({
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
      <input aria-label={label} value={value} onChange={(e: any) => onChange(e.target.value)} />
      {error ? <div role="alert">{error}</div> : null}
    </div>
  ),
}));
vi.mock('../../components/ui/FormSelect', () => ({
  default: forwardRef(({ label, options, error, ...props }: any, ref: any) => (
    <div>
      <select ref={ref} aria-label={label} {...props}>
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
vi.mock('../../components/ui/Button', () => ({
  default: ({ children, isLoading, ...props }: any) => <button {...props}>{children}</button>,
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <WelcomePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockProfile = undefined;
});

describe('WelcomePage role-aware sections', () => {
  it('shows the business/tax/address sections for an ADMIN and prefills the tenant name', () => {
    mockProfile = {
      role: 'ADMIN',
      firstName: 'Ann',
      lastName: 'Owner',
      phone: null,
      tenantName: 'Existing Diner',
    };
    renderPage();
    const business = screen.getByLabelText('İşletme adı *') as HTMLInputElement;
    expect(business).toBeInTheDocument();
    expect(screen.getByLabelText('Vergi No / TC Kimlik')).toBeInTheDocument();
    expect(screen.getByLabelText('Adres')).toBeInTheDocument();
    expect(screen.getByLabelText('Saat dilimi')).toBeInTheDocument();
    // Prefilled from the profile — a re-visit must not force a blind retype.
    expect(business.value).toBe('Existing Diner');
  });

  it('hides the tenant-scoped sections entirely for a staff role', () => {
    mockProfile = { role: 'WAITER', firstName: 'Sam', lastName: 'Staff', phone: null };
    renderPage();
    expect(screen.queryByLabelText('İşletme adı *')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Vergi No / TC Kimlik')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Adres')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Saat dilimi')).not.toBeInTheDocument();
    // User-scoped fields stay.
    expect(screen.getByLabelText('Telefon *')).toBeInTheDocument();
    expect(screen.getByLabelText('Dil')).toBeInTheDocument();
  });

  it('lets a staff user submit WITHOUT a business name and sends only user-scoped fields', async () => {
    mockProfile = { role: 'WAITER', firstName: 'Sam', lastName: 'Staff', phone: null };
    renderPage();
    fireEvent.change(screen.getByLabelText('Telefon *'), {
      target: { value: '+905551234567' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tamamla ve devam et' }));

    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    const payload = complete.mock.calls[0][0];
    expect(payload).toEqual({
      phone: '+905551234567',
      firstName: 'Sam',
      lastName: 'Staff',
      locale: 'tr',
    });
    expect(payload).not.toHaveProperty('businessName');
    expect(payload).not.toHaveProperty('taxId');
    expect(payload).not.toHaveProperty('addressLine');
  });

  it('still requires the business name for an ADMIN', async () => {
    mockProfile = { role: 'ADMIN', firstName: 'Ann', lastName: 'Owner', phone: null };
    renderPage();
    fireEvent.change(screen.getByLabelText('Telefon *'), {
      target: { value: '+905551234567' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tamamla ve devam et' }));

    await waitFor(() =>
      expect(screen.getByText('This field is required')).toBeInTheDocument(),
    );
    expect(complete).not.toHaveBeenCalled();
  });
});
