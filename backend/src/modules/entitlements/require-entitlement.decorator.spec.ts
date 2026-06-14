import {
  RequireEntitlement,
  REQUIRE_ENTITLEMENT_KEY,
} from './require-entitlement.decorator';

/**
 * Spec for the @RequireEntitlement metadata decorator. It stores the variadic
 * requirement list under REQUIRE_ENTITLEMENT_KEY for the entitlement guard to
 * read. Covers the string, {feature}, {limit,usage} and {integration,provider}
 * shapes plus multiple requirements on one route.
 */
describe('@RequireEntitlement', () => {
  function metaOf(...reqs: Parameters<typeof RequireEntitlement>): unknown {
    class Probe {
      @RequireEntitlement(...reqs)
      handler() {}
    }
    return Reflect.getMetadata(REQUIRE_ENTITLEMENT_KEY, Probe.prototype.handler);
  }

  it('stores a single string feature requirement', () => {
    expect(metaOf('feature.kds')).toEqual(['feature.kds']);
  });

  it('stores a {feature} object requirement', () => {
    expect(metaOf({ feature: 'feature.advancedReports' })).toEqual([
      { feature: 'feature.advancedReports' },
    ]);
  });

  it('stores a {limit, usage} requirement (usage fn preserved by reference)', () => {
    const usage = (req: any) => req.tables;
    const meta = metaOf({ limit: 'limit.maxTables', usage }) as any[];
    expect(meta[0].limit).toBe('limit.maxTables');
    expect(meta[0].usage).toBe(usage);
  });

  it('stores an {integration, provider} requirement', () => {
    expect(metaOf({ integration: 'integration.delivery', provider: 'yemeksepeti' })).toEqual([
      { integration: 'integration.delivery', provider: 'yemeksepeti' },
    ]);
  });

  it('preserves multiple requirements in order', () => {
    expect(metaOf('feature.kds', { feature: 'feature.pos' })).toEqual([
      'feature.kds',
      { feature: 'feature.pos' },
    ]);
  });
});
