import { allowsIntegration, fold, hasFeature, isUnlimitedLimit, limitOf } from './entitlement-engine';
import { EntitlementGrant } from './entitlement.types';

// Tiny helper that lets each test focus on the few fields the engine actually
// inspects without re-typing tenantId/branchId/scope every time.
const g = (over: Partial<EntitlementGrant> & Pick<EntitlementGrant, 'key' | 'value' | 'source'>): EntitlementGrant => ({
  tenantId: 't1',
  branchId: null,
  scope: 'tenant',
  validUntil: null,
  ...over,
});

describe('entitlement-engine fold()', () => {
  it('returns empty set when no grants', () => {
    const set = fold([]);
    expect(set.features).toEqual({});
    expect(set.limits).toEqual({});
    expect(set.integrations).toEqual({});
  });

  it('feature.* combines with OR — any enabling grant turns it on', () => {
    const set = fold([
      g({ key: 'feature.kds', value: false, source: 'plan:STARTER' }),
      g({ key: 'feature.kds', value: true, source: 'addon:kds-extra-station' }),
    ]);
    expect(hasFeature(set, 'feature.kds')).toBe(true);
  });

  it('feature.* stays false when no grant enables it', () => {
    const set = fold([
      g({ key: 'feature.advancedReports', value: false, source: 'plan:STARTER' }),
    ]);
    expect(hasFeature(set, 'feature.advancedReports')).toBe(false);
  });

  it('limit.* sums numeric grants', () => {
    const set = fold([
      g({ key: 'limit.kdsScreens', value: 1, source: 'plan:POS_PRO' }),
      g({ key: 'limit.kdsScreens', value: 1, source: 'addon:kds-extra-screen:a' }),
      g({ key: 'limit.kdsScreens', value: 2, source: 'addon:kds-extra-screen:b' }),
    ]);
    expect(limitOf(set, 'limit.kdsScreens')).toBe(4);
  });

  it('limit.* propagates -1 as unlimited regardless of additive grants', () => {
    const set = fold([
      g({ key: 'limit.maxTables', value: 50, source: 'plan:PRO' }),
      g({ key: 'limit.maxTables', value: -1, source: 'plan:BUSINESS' }),
      g({ key: 'limit.maxTables', value: 10, source: 'addon:extra-tables' }),
    ]);
    expect(isUnlimitedLimit(set, 'limit.maxTables')).toBe(true);
    expect(limitOf(set, 'limit.maxTables')).toBe(-1);
  });

  it('integration.* unions deduplicated providers', () => {
    const set = fold([
      g({ key: 'integration.delivery', value: ['yemeksepeti', 'getir'], source: 'plan:PRO' }),
      g({ key: 'integration.delivery', value: ['getir', 'trendyolyemek'], source: 'addon:delivery-hub' }),
    ]);
    expect(set.integrations['integration.delivery']).toEqual(['getir', 'trendyolyemek', 'yemeksepeti']);
    expect(allowsIntegration(set, 'integration.delivery', 'yemeksepeti')).toBe(true);
    expect(allowsIntegration(set, 'integration.delivery', 'unknown')).toBe(false);
  });

  it('integration.* wildcard "*" grants all providers', () => {
    const set = fold([
      g({ key: 'integration.delivery', value: ['*'], source: 'plan:BUSINESS' }),
    ]);
    expect(allowsIntegration(set, 'integration.delivery', 'anything-new')).toBe(true);
  });

  it('replacement wrapper overrides additive results', () => {
    const set = fold([
      g({ key: 'limit.maxUsers', value: 5, source: 'plan:BASIC' }),
      g({ key: 'limit.maxUsers', value: 3, source: 'addon:extra-users' }),
      // Admin override: hard cap at 2 regardless of other grants.
      g({ key: 'limit.maxUsers', value: { __replace: 2 } as any, source: 'override:admin' }),
    ]);
    expect(limitOf(set, 'limit.maxUsers')).toBe(2);
  });

  it('replacement wrapper can disable a feature even if plan enables it', () => {
    const set = fold([
      g({ key: 'feature.deliveryIntegration', value: true, source: 'plan:PRO' }),
      g({ key: 'feature.deliveryIntegration', value: { __replace: false } as any, source: 'override:admin' }),
    ]);
    expect(hasFeature(set, 'feature.deliveryIntegration')).toBe(false);
  });

  it('grants past their validUntil are ignored', () => {
    const past = new Date('2020-01-01');
    const set = fold([
      g({ key: 'feature.kds', value: true, source: 'grace:past-due', validUntil: past }),
    ]);
    expect(hasFeature(set, 'feature.kds')).toBe(false);
  });

  it('grants with future validUntil are included', () => {
    const future = new Date(Date.now() + 60_000);
    const set = fold([
      g({ key: 'feature.kds', value: true, source: 'grace:past-due', validUntil: future }),
    ]);
    expect(hasFeature(set, 'feature.kds')).toBe(true);
  });

  it('ignores grants with malformed keys', () => {
    const set = fold([
      g({ key: 'totallyUnknown', value: true, source: 'oops' } as any),
      g({ key: 'feature', value: true, source: 'oops' } as any),
    ]);
    expect(set.features).toEqual({});
    expect(set.limits).toEqual({});
  });
});
