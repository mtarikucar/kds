import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlanAndAccessPage from './PlanAndAccessPage';

// Echo i18n defaultValue (the page supplies tr-TR copy as defaultValue) so
// rendered labels are the real strings the user sees.
//
// EXCEPTION: keys under the real, resolvable
// `subscriptions:subscriptions.comparison.features.*` path (see
// subscriptions.json — every locale wraps its content under a top-level
// "subscriptions" key, so the namespace prefix and the JSON's own key both
// say "subscriptions") are treated as if i18next actually resolved them,
// returning a translated sentinel instead of falling through to
// defaultValue. This is what a real i18next instance would do once the key
// resolves, and it lets the Included-band test below catch a regression to
// the wrong (single-prefix) path: a wrong path would never match this
// regex, so the mock would silently fall back to the Turkish defaultLabel
// for every locale again — exactly the bug this test guards against.
const FEATURE_KEY_RE = /^subscriptions:subscriptions\.comparison\.features\.(\w+)$/;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      const resolved = FEATURE_KEY_RE.exec(key);
      if (resolved) return `i18n-resolved:${resolved[1]}`;
      if (typeof opts?.defaultValue !== 'string') return key;
      // Mirror i18next {{var}} interpolation for the values the page passes
      // (e.g. {{date}}), so date-formatting behavior is actually exercised.
      return opts.defaultValue.replace(/\{\{(\w+)\}\}/g, (_m: string, v: string) =>
        opts[v] != null ? String(opts[v]) : `{{${v}}}`,
      );
    },
  }),
}));

// --- data hooks ---
const subscriptionRef: { value: any } = { value: null };
const snapshotRef: { value: any } = { value: undefined };
const catalogRef: { value: any[] } = { value: [] };
const myAddOnsRef: { value: any[] } = { value: [] };
const planRef: { value: any } = { value: null };
// Defaults to "nothing on" so tests that don't care about the Included
// band's feature chips don't get surprise output from a stale flag set.
const hasFeatureRef: { value: (feature: string) => boolean } = {
  value: () => false,
};
const cancelAddOnMutate = vi.fn();
let cancelPending = false;

vi.mock('../subscriptions/subscriptionsApi', () => ({
  useGetCurrentSubscription: () => ({ data: subscriptionRef.value }),
}));
vi.mock('../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ plan: planRef.value, hasFeature: hasFeatureRef.value }),
}));
vi.mock('./planApi', () => ({
  useGetUsageSnapshot: () => ({ data: snapshotRef.value }),
}));
vi.mock('../marketplace/marketplaceApi', () => ({
  useListAddOns: () => ({ data: catalogRef.value }),
  useListMyAddOns: () => ({ data: myAddOnsRef.value }),
  useCancelAddOn: () => ({ mutate: cancelAddOnMutate, isPending: cancelPending }),
}));
// The subscription/billing management section (folded in from the old
// /subscription/manage page) has its own data hooks; stub it here so this
// page test stays focused on the plan/quota/add-on sections.
vi.mock('../../pages/settings/SubscriptionSettingsPage', () => ({
  default: () => <div data-testid="subscription-management" />,
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <PlanAndAccessPage />
    </MemoryRouter>,
  );
}

describe('PlanAndAccessPage', () => {
  beforeEach(() => {
    subscriptionRef.value = null;
    snapshotRef.value = undefined;
    catalogRef.value = [];
    myAddOnsRef.value = [];
    planRef.value = null;
    hasFeatureRef.value = () => false;
    cancelAddOnMutate.mockClear();
    cancelPending = false;
  });

  it('embeds the subscription/billing management section (merged from /subscription/manage)', () => {
    planRef.value = { displayName: 'Pro', currency: 'TRY' };
    renderPage();
    expect(screen.getByTestId('subscription-management')).toBeInTheDocument();
  });

  it('renders the quota card with current/max and a quota grid', () => {
    planRef.value = { displayName: 'Basic', currency: 'TRY' };
    snapshotRef.value = {
      users: { current: 4, max: 5 },
      branches: { current: 1, max: 1 },
      products: { current: 10, max: 100 },
      monthlyOrders: { current: 2, max: -1 },
    };

    renderPage();

    // users 4/5 → over 80% → warn; the "4" and "/ 5" appear.
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('/ 5')).toBeInTheDocument();
    // monthlyOrders is unlimited (-1) → "Sınırsız" chip, no "/ -1".
    expect(screen.getByText('Sınırsız')).toBeInTheDocument();
    expect(screen.queryByText('/ -1')).toBeNull();
  });

  it('formats add-on prices from cents into the plan currency with /ay for recurring', () => {
    planRef.value = { displayName: 'Pro', currency: 'TRY' };
    myAddOnsRef.value = [
      {
        id: 'ta-1',
        quantity: 1,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: '2026-08-01T00:00:00.000Z',
        addOn: {
          name: 'Fiscal Integration',
          code: 'fiscal',
          priceCents: 49900, // → 499 TRY (maximumFractionDigits: 0)
          billing: 'recurring',
        },
      },
    ];

    renderPage();

    expect(screen.getByText('Fiscal Integration')).toBeInTheDocument();
    // 49900 cents → ₺499/ay (tr-TR currency, 0 fraction digits). The symbol
    // placement is locale-driven; assert the numeric + /ay suffix robustly.
    const priceCell = screen.getByText(/499/);
    expect(priceCell.textContent).toContain('/ay');
  });

  it('cancels an active add-on at period end (not immediate) via the mutation', () => {
    planRef.value = { displayName: 'Pro', currency: 'TRY' };
    myAddOnsRef.value = [
      {
        id: 'ta-77',
        quantity: 1,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: '2026-08-01T00:00:00.000Z',
        addOn: { name: 'Caller ID', code: 'caller', priceCents: 9900, billing: 'recurring' },
      },
    ];

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'İptal et' }));

    expect(cancelAddOnMutate).toHaveBeenCalledTimes(1);
    expect(cancelAddOnMutate).toHaveBeenCalledWith({
      id: 'ta-77',
      immediate: false,
    });
  });

  it('hides the cancel CTA for an add-on already scheduled to cancel', () => {
    planRef.value = { displayName: 'Pro', currency: 'TRY' };
    myAddOnsRef.value = [
      {
        id: 'ta-88',
        quantity: 2,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-08-01T00:00:00.000Z',
        addOn: { name: 'Extra Branch', code: 'branch', priceCents: 19900, billing: 'recurring' },
      },
    ];

    renderPage();

    expect(screen.getByText('Extra Branch')).toBeInTheDocument();
    expect(screen.getByText('Dönem sonu iptal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'İptal et' })).toBeNull();
  });

  it('shows the empty state when the tenant owns no add-ons', () => {
    planRef.value = { displayName: 'Free', currency: 'TRY' };
    myAddOnsRef.value = [];

    renderPage();

    expect(
      screen.getByText(
        'Henüz eklentiniz yok. Aşağıdan önerilen eklentilere göz atabilirsiniz.',
      ),
    ).toBeInTheDocument();
  });

  it('suggests catalog add-ons the tenant does not own (excludes owned codes)', () => {
    planRef.value = { displayName: 'Pro', currency: 'TRY' };
    myAddOnsRef.value = [
      { id: 'ta-1', quantity: 1, cancelAtPeriodEnd: false, currentPeriodEnd: null, addOn: { name: 'Fiscal', code: 'fiscal', priceCents: 0, billing: 'oneTime' } },
    ];
    catalogRef.value = [
      { code: 'fiscal', name: 'Fiscal', kind: 'integration', billing: 'recurring', priceCents: 49900, currency: 'TRY', deps: [], includedInPlan: false },
      { code: 'caller', name: 'Caller ID', kind: 'integration', billing: 'recurring', priceCents: 9900, currency: 'TRY', deps: [], includedInPlan: false },
    ];

    renderPage();

    // Owned "fiscal" is excluded from suggestions; "caller" is suggested.
    const suggested = screen.getByText('Önerilen eklentiler').closest('section')!;
    expect(within(suggested).getByText('Caller ID')).toBeInTheDocument();
    expect(within(suggested).queryByText('Fiscal')).toBeNull();
  });

  it('shows a plan-included add-on in the Included band with the "Planınıza dahil" badge, and excludes it from the purchasable list', () => {
    planRef.value = { displayName: 'Pro', currency: 'TRY' };
    catalogRef.value = [
      {
        code: 'fiscal',
        name: 'Fiscal Integration',
        kind: 'integration',
        billing: 'recurring',
        priceCents: 49900,
        currency: 'TRY',
        deps: [],
        includedInPlan: true,
      },
    ];

    renderPage();

    const included = screen.getByText('Planınıza dahil olanlar').closest('section')!;
    expect(within(included).getByText('Fiscal Integration')).toBeInTheDocument();
    expect(within(included).getByText('Planınıza dahil')).toBeInTheDocument();

    // Included → never offered for sale. Nothing purchasable means the
    // "Önerilen eklentiler" section doesn't render at all.
    expect(screen.queryByText('Önerilen eklentiler')).toBeNull();
  });

  it('does NOT show an add-on with includedInPlan===undefined as purchasable (fail-closed)', () => {
    planRef.value = { displayName: 'Pro', currency: 'TRY' };
    catalogRef.value = [
      {
        code: 'mystery',
        name: 'Mystery Add-on',
        kind: 'software',
        billing: 'oneTime',
        priceCents: 10000,
        currency: 'TRY',
        deps: [],
        // includedInPlan intentionally omitted → undefined (shape drift).
      },
    ];

    renderPage();

    // Fail-closed: undefined is neither confirmed-included nor
    // confirmed-purchasable, so it must not be offered for sale.
    expect(screen.queryByText('Önerilen eklentiler')).toBeNull();
    expect(screen.queryByText('Mystery Add-on')).toBeNull();
  });

  it("renders the plan's ON boolean features in the Included band (and leaves OFF features out)", () => {
    planRef.value = { displayName: 'Pro', currency: 'TRY' };
    hasFeatureRef.value = (feature: string) =>
      feature === 'posAccess' || feature === 'advancedReports';

    renderPage();

    const included = screen.getByText('Planınıza dahil olanlar').closest('section')!;
    // Rendered via the `i18n-resolved:` sentinel (see the react-i18next mock
    // above), which only fires for the correct, resolvable
    // `subscriptions:subscriptions.comparison.features.<flag>` key path. If
    // the component regresses to the wrong (single-prefix) path, these
    // would fall through to the mock's defaultValue echo and render the
    // Turkish defaultLabel instead — failing this assertion.
    expect(within(included).getByText('i18n-resolved:posAccess')).toBeInTheDocument();
    expect(within(included).getByText('i18n-resolved:advancedReports')).toBeInTheDocument();
    // customBranding is OFF for this plan → must not appear.
    expect(within(included).queryByText('i18n-resolved:customBranding')).toBeNull();
    expect(within(included).queryByText('Özel marka')).toBeNull();
  });

  it('resolves Included-band feature labels via the correct double-prefixed subscriptions i18n key path (not the single-prefixed one)', () => {
    planRef.value = { displayName: 'Pro', currency: 'TRY' };
    hasFeatureRef.value = (feature: string) => feature === 'advancedReports';

    renderPage();

    const included = screen.getByText('Planınıza dahil olanlar').closest('section')!;
    // Regression guard for the bug where the page called
    // t(`subscriptions:comparison.features.${flag}`) — missing the JSON's
    // own top-level "subscriptions" wrapper — which never resolves and
    // silently falls back to the hardcoded Turkish defaultLabel for every
    // locale (en/ar/ru/uz users saw Turkish). The Turkish defaultLabel must
    // NOT be the rendered text; the resolved-key sentinel must be.
    expect(within(included).queryByText('Gelişmiş raporlar')).toBeNull();
    expect(within(included).getByText('i18n-resolved:advancedReports')).toBeInTheDocument();
  });

  it('points the quota upgrade CTA at /subscription/change-plan, not the plan page itself', () => {
    planRef.value = { displayName: 'Pro', currency: 'TRY' };
    snapshotRef.value = {
      users: { current: 5, max: 5 }, // 100% used → "full" → upgrade CTA shows
    };

    renderPage();

    const link = screen.getByRole('link', { name: /Üst pakete geç/ });
    expect(link).toHaveAttribute('href', '/subscription/change-plan');
  });
});
