import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ReactNode } from 'react';
import { SubscriptionProvider, useEntitlements } from './SubscriptionContext';

const mockUseLicensing = vi.fn();
vi.mock('../features/licensing/licensingApi', () => ({
  useLicensing: () => mockUseLicensing(),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <SubscriptionProvider>{children}</SubscriptionProvider>
);

const snapshot = (over: Record<string, unknown> = {}) => ({
  data: {
    entitlements: {
      features: { 'feature.posAccess': true },
      limits: { 'limit.maxBranches': 1, 'limit.maxTables': -1 },
      integrations: { 'integration.delivery': ['getir'] },
      computedAt: '2026-08-11T00:00:00.000Z',
    },
    license: {
      status: 'active',
      anchorAt: '2026-03-10T00:00:00.000Z',
      anniversaryAt: '2027-03-10T00:00:00.000Z',
      daysRemaining: 211,
    },
    credits: { PHOTO: 60 },
    owned: [],
    renewal: null,
    offers: {
      'feature.advancedReports': {
        code: 'advanced_reports',
        name: 'Gelişmiş Rapor',
        kind: 'module',
        annualPriceCents: 129_000,
        proratedCents: 125_466,
        currency: 'TRY',
        periodEnd: '2027-03-10T00:00:00.000Z',
      },
    },
    ...over,
  },
  isLoading: false,
});

describe('EntitlementContext', () => {
  beforeEach(() => mockUseLicensing.mockReturnValue(snapshot()));

  it('accepts both bare and prefixed feature keys', () => {
    const { result } = renderHook(() => useEntitlements(), { wrapper });
    expect(result.current.hasFeature('posAccess')).toBe(true);
    expect(result.current.hasFeature('feature.posAccess')).toBe(true);
    expect(result.current.hasFeature('advancedReports')).toBe(false);
  });

  it('FAILS CLOSED while the snapshot is loading', () => {
    // Deliberate: flashing a gated screen and then yanking it away is worse
    // than a moment of nothing, and there is no safe fallback source — the
    // folded set is the only thing that knows about suppression overrides.
    mockUseLicensing.mockReturnValue({ data: undefined, isLoading: true });
    const { result } = renderHook(() => useEntitlements(), { wrapper });
    expect(result.current.hasFeature('posAccess')).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it('treats -1 as unlimited and reports remaining for a real cap', () => {
    const { result } = renderHook(() => useEntitlements(), { wrapper });
    expect(result.current.checkLimit('maxTables', 9_999)).toMatchObject({
      allowed: true,
      limit: -1,
    });
    expect(result.current.checkLimit('maxBranches', 1)).toMatchObject({
      allowed: false,
      limit: 1,
      remaining: 0,
    });
  });

  it('denies a limit it has never heard of', () => {
    const { result } = renderHook(() => useEntitlements(), { wrapper });
    expect(result.current.checkLimit('maxWidgets', 0).allowed).toBe(false);
  });

  it('matches an integration domain with or without a vendor', () => {
    const { result } = renderHook(() => useEntitlements(), { wrapper });
    expect(result.current.hasIntegration('delivery')).toBe(true);
    expect(result.current.hasIntegration('delivery', 'getir')).toBe(true);
    expect(result.current.hasIntegration('delivery', 'yemeksepeti')).toBe(false);
    expect(result.current.hasIntegration('fiscal')).toBe(false);
  });

  it('honours the "*" vendor wildcard', () => {
    mockUseLicensing.mockReturnValue(
      snapshot({
        entitlements: {
          features: {},
          limits: {},
          integrations: { 'integration.sms': ['*'] },
          computedAt: '',
        },
      }),
    );
    const { result } = renderHook(() => useEntitlements(), { wrapper });
    expect(result.current.hasIntegration('sms', 'anything')).toBe(true);
  });

  it('resolves an offer by grant key, prefixed or not', () => {
    // This is what replaced the hardcoded feature→plan table: the price on
    // the upsell comes from the same catalog read as the price at checkout.
    const { result } = renderHook(() => useEntitlements(), { wrapper });
    expect(result.current.offerFor('advancedReports')?.proratedCents).toBe(125_466);
    expect(result.current.offerFor('feature.advancedReports')?.code).toBe(
      'advanced_reports',
    );
    expect(result.current.offerFor('feature.nope')).toBeNull();
  });

  it('exposes licence state and credit balances', () => {
    const { result } = renderHook(() => useEntitlements(), { wrapper });
    expect(result.current.license.status).toBe('active');
    expect(result.current.license.daysRemaining).toBe(211);
    expect(result.current.credits.PHOTO).toBe(60);
  });
});
