// Pure helpers extracted (verbatim) from TenantDetailPage so they can be
// unit-tested in isolation. The component re-imports them at the original
// call sites, so runtime behavior is byte-identical.
import { TenantOverridesResponse } from '../../features/superadmin/types';

export type FeatureOverrideState = 'default' | 'on' | 'off';

// Tri-state cycle for a feature override toggle: default → on → off → default.
export function cycleFeatureOverrideState(
  current: FeatureOverrideState,
): FeatureOverrideState {
  return current === 'default' ? 'on' : current === 'on' ? 'off' : 'default';
}

// Build the featureOverrides payload from the per-key tri-state form values.
// 'on' → true, 'off' → false, 'default' → null (remove override).
export function buildFeatureOverridesPayload(
  featureStates: Record<string, FeatureOverrideState>,
): Record<string, boolean | null> {
  const featureOverrides: Record<string, boolean | null> = {};
  for (const [key, state] of Object.entries(featureStates)) {
    if (state === 'on') featureOverrides[key] = true;
    else if (state === 'off') featureOverrides[key] = false;
    else featureOverrides[key] = null; // Remove override
  }
  return featureOverrides;
}

// Build the limitOverrides payload from the per-key string form values.
// Empty / undefined → null (remove override), otherwise the numeric value.
export function buildLimitOverridesPayload(
  limitValues: Record<string, string>,
): Record<string, number | null> {
  const limitOverrides: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(limitValues)) {
    if (value === '' || value === undefined) {
      limitOverrides[key] = null; // Remove override
    } else {
      limitOverrides[key] = Number(value);
    }
  }
  return limitOverrides;
}

// Resolve the effective boolean for a feature: forced override wins, else the
// plan default, else false.
export function getEffectiveFeature(
  key: string,
  featureStates: Record<string, FeatureOverrideState>,
  overridesData: TenantOverridesResponse | undefined,
): boolean {
  const state = featureStates[key];
  if (state === 'on') return true;
  if (state === 'off') return false;
  return overridesData?.planDefaults?.features?.[key] ?? false;
}

// Resolve the effective numeric limit: a non-empty override value wins, else
// the plan default, else 0.
export function getEffectiveLimit(
  key: string,
  limitValues: Record<string, string>,
  overridesData: TenantOverridesResponse | undefined,
): number {
  const val = limitValues[key];
  if (val !== '' && val !== undefined) return Number(val);
  return overridesData?.planDefaults?.limits?.[key] ?? 0;
}

// Map API override data into the initial per-key feature tri-state form values.
// true → 'on', false → 'off', absent → 'default'. Mirrors the useEffect init.
export function initFeatureStates(
  featureKeys: string[],
  overridesData: TenantOverridesResponse,
): Record<string, FeatureOverrideState> {
  const fStates: Record<string, FeatureOverrideState> = {};
  for (const key of featureKeys) {
    if (overridesData.featureOverrides?.[key] === true) {
      fStates[key] = 'on';
    } else if (overridesData.featureOverrides?.[key] === false) {
      fStates[key] = 'off';
    } else {
      fStates[key] = 'default';
    }
  }
  return fStates;
}

// Map API override data into the initial per-key limit string form values.
// Defined (non-null) → String(value), otherwise ''. Mirrors the useEffect init.
export function initLimitValues(
  limitKeys: string[],
  overridesData: TenantOverridesResponse,
): Record<string, string> {
  const lValues: Record<string, string> = {};
  for (const key of limitKeys) {
    if (overridesData.limitOverrides?.[key] !== undefined && overridesData.limitOverrides?.[key] !== null) {
      lValues[key] = String(overridesData.limitOverrides[key]);
    } else {
      lValues[key] = '';
    }
  }
  return lValues;
}
