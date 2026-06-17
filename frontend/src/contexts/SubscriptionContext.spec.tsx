import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SubscriptionProvider, useSubscription } from './SubscriptionContext';

/**
 * v2.8.88 — hasIntegration helper regression.
 *
 * Pre-v2.8.88 the frontend had no concept of integration grants — the
 * only signal was the flat `feature.deliveryIntegration: true` boolean.
 * Post-v2.8.88 the engine surfaces a per-vendor map. The helper
 * collapses both "any vendor in this domain" and "this exact vendor"
 * queries.
 */

vi.mock('../features/subscriptions/subscriptionsApi', () => ({
  useGetCurrentSubscription: () => ({ data: { status: 'ACTIVE' }, isLoading: false }),
  useGetPlans: () => ({ data: [], isLoading: false }),
  useGetEffectiveFeatures: () => ({
    data: globalThis.__effective,
    isLoading: false,
  }),
}));

declare global {
  // eslint-disable-next-line no-var
  var __effective: any;
}

function ContextProbe({ onReady }: { onReady: (ctx: any) => void }) {
  const ctx = useSubscription();
  onReady(ctx);
  return <div data-testid="ready">ok</div>;
}

function renderWith(effective: any) {
  globalThis.__effective = effective;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let captured: any = null;
  render(
    <QueryClientProvider client={qc}>
      <SubscriptionProvider>
        <ContextProbe onReady={(c) => (captured = c)} />
      </SubscriptionProvider>
    </QueryClientProvider>,
  );
  return captured;
}

describe('SubscriptionContext.hasIntegration (v2.8.88)', () => {
  it('returns true for "any vendor in domain" when the domain has at least one entry', () => {
    const ctx = renderWith({
      features: {},
      limits: {},
      integrations: { delivery: ['yemeksepeti'] },
    });
    expect(ctx.hasIntegration('delivery')).toBe(true);
  });

  it('returns true for the exact vendor when present', () => {
    const ctx = renderWith({
      features: {},
      limits: {},
      integrations: { delivery: ['yemeksepeti', 'getir'] },
    });
    expect(ctx.hasIntegration('delivery', 'getir')).toBe(true);
  });

  it('returns false when the vendor is not in the domain list', () => {
    const ctx = renderWith({
      features: {},
      limits: {},
      integrations: { delivery: ['yemeksepeti'] },
    });
    expect(ctx.hasIntegration('delivery', 'trendyol_yemek')).toBe(false);
  });

  it('returns false when the domain key is missing', () => {
    const ctx = renderWith({
      features: {},
      limits: {},
      integrations: {},
    });
    expect(ctx.hasIntegration('fiscal')).toBe(false);
  });

  it('returns false when integrations is undefined (old backend / loading)', () => {
    const ctx = renderWith({ features: {}, limits: {} });
    expect(ctx.hasIntegration('fiscal')).toBe(false);
    expect(screen.getByTestId('ready')).toBeInTheDocument();
  });
});

/**
 * deep-review FL2 — gates must fail CLOSED when effective-features is
 * unavailable (still loading, or persistently errored). effective-features
 * is the documented source of truth (it folds in per-tenant featureOverrides),
 * so we must never fall back to the raw plan, which ignores negative overrides
 * and would over-grant a feature an admin/abuse override has disabled.
 */
describe('SubscriptionContext fail-closed gating (deep-review FL2)', () => {
  it('hasFeature returns false when effectiveFeatures is unavailable', () => {
    const ctx = renderWith(undefined);
    expect(ctx.hasFeature('posAccess' as any)).toBe(false);
  });

  it('checkLimit denies (limit 0) when effectiveFeatures is unavailable', () => {
    const ctx = renderWith(undefined);
    const result = ctx.checkLimit('maxBranches' as any, 0);
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it('hasFeature honors a negative override from effectiveFeatures', () => {
    const ctx = renderWith({ features: { posAccess: false }, limits: {} });
    expect(ctx.hasFeature('posAccess' as any)).toBe(false);
  });

  it('hasFeature grants when effectiveFeatures enables it', () => {
    const ctx = renderWith({ features: { posAccess: true }, limits: {} });
    expect(ctx.hasFeature('posAccess' as any)).toBe(true);
  });
});
