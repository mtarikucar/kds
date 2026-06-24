import { describe, expect, it } from 'vitest';
import { TenantOverridesResponse } from '../../features/superadmin/types';
import {
  buildFeatureOverridesPayload,
  buildLimitOverridesPayload,
  cycleFeatureOverrideState,
  getEffectiveFeature,
  getEffectiveLimit,
  initFeatureStates,
  initLimitValues,
} from './tenantOverrides.helpers';

const overrides = (over: Partial<TenantOverridesResponse> = {}): TenantOverridesResponse => ({
  featureOverrides: null,
  limitOverrides: null,
  planDefaults: { features: {}, limits: {} },
  effective: { features: {}, limits: {} },
  ...over,
});

describe('cycleFeatureOverrideState', () => {
  it('cycles default -> on -> off -> default', () => {
    expect(cycleFeatureOverrideState('default')).toBe('on');
    expect(cycleFeatureOverrideState('on')).toBe('off');
    expect(cycleFeatureOverrideState('off')).toBe('default');
  });
});

describe('buildFeatureOverridesPayload', () => {
  it("maps 'on' -> true, 'off' -> false, 'default' -> null", () => {
    expect(
      buildFeatureOverridesPayload({ a: 'on', b: 'off', c: 'default' }),
    ).toEqual({ a: true, b: false, c: null });
  });

  it('returns an empty object for empty input', () => {
    expect(buildFeatureOverridesPayload({})).toEqual({});
  });

  // M10: the override editor must be able to grant the revenue-gating modules.
  // The helper iterates featureStates dynamically, so as long as the new
  // FEATURE_LABELS keys seed featureStates they round-trip. Lock the contract.
  it('round-trips the M10 module flags (deliveryIntegration / externalDisplay / posAccess)', () => {
    expect(
      buildFeatureOverridesPayload({
        deliveryIntegration: 'on',
        externalDisplay: 'on',
        posAccess: 'off',
      }),
    ).toEqual({ deliveryIntegration: true, externalDisplay: true, posAccess: false });
  });
});

describe('buildLimitOverridesPayload', () => {
  it('maps empty string to null and other values to Number()', () => {
    expect(
      buildLimitOverridesPayload({ maxUsers: '5', maxTables: '', maxProducts: '0' }),
    ).toEqual({ maxUsers: 5, maxTables: null, maxProducts: 0 });
  });

  // M10: maxBranches is a per-tenant limit the override editor must send.
  it('round-trips the maxBranches limit override', () => {
    expect(buildLimitOverridesPayload({ maxBranches: '3' })).toEqual({ maxBranches: 3 });
    // Empty -> null (remove override) like every other limit.
    expect(buildLimitOverridesPayload({ maxBranches: '' })).toEqual({ maxBranches: null });
  });
});

describe('getEffectiveFeature', () => {
  it('forced override wins over the plan default', () => {
    const data = overrides({ planDefaults: { features: { x: true }, limits: {} } });
    expect(getEffectiveFeature('x', { x: 'off' }, data)).toBe(false);
    expect(getEffectiveFeature('x', { x: 'on' }, data)).toBe(true);
  });

  it('falls back to the plan default when state is default', () => {
    const data = overrides({ planDefaults: { features: { x: true }, limits: {} } });
    expect(getEffectiveFeature('x', { x: 'default' }, data)).toBe(true);
  });

  it('falls back to false when no plan default and no override data', () => {
    expect(getEffectiveFeature('x', {}, undefined)).toBe(false);
    expect(getEffectiveFeature('x', {}, overrides())).toBe(false);
  });
});

describe('getEffectiveLimit', () => {
  it('a non-empty override value wins over the plan default', () => {
    const data = overrides({ planDefaults: { features: {}, limits: { maxUsers: 10 } } });
    expect(getEffectiveLimit('maxUsers', { maxUsers: '3' }, data)).toBe(3);
    // '0' is non-empty -> wins (Number('0') === 0).
    expect(getEffectiveLimit('maxUsers', { maxUsers: '0' }, data)).toBe(0);
  });

  it('falls back to the plan default when override is empty', () => {
    const data = overrides({ planDefaults: { features: {}, limits: { maxUsers: 10 } } });
    expect(getEffectiveLimit('maxUsers', { maxUsers: '' }, data)).toBe(10);
  });

  it('falls back to 0 when no plan default and no override data', () => {
    expect(getEffectiveLimit('maxUsers', {}, undefined)).toBe(0);
    expect(getEffectiveLimit('maxUsers', { maxUsers: '' }, overrides())).toBe(0);
  });
});

describe('initFeatureStates', () => {
  it('maps true -> on, false -> off, absent -> default', () => {
    const data = overrides({ featureOverrides: { a: true, b: false } });
    expect(initFeatureStates(['a', 'b', 'c'], data)).toEqual({
      a: 'on',
      b: 'off',
      c: 'default',
    });
  });

  it('treats null featureOverrides as all default', () => {
    expect(initFeatureStates(['a', 'b'], overrides())).toEqual({
      a: 'default',
      b: 'default',
    });
  });
});

describe('initLimitValues', () => {
  it('stringifies defined limit overrides and blanks the rest', () => {
    const data = overrides({ limitOverrides: { maxUsers: 5, maxTables: 0 } });
    expect(initLimitValues(['maxUsers', 'maxTables', 'maxProducts'], data)).toEqual({
      maxUsers: '5',
      maxTables: '0',
      maxProducts: '',
    });
  });

  it('treats null limitOverrides as all blank', () => {
    expect(initLimitValues(['maxUsers'], overrides())).toEqual({ maxUsers: '' });
  });
});
