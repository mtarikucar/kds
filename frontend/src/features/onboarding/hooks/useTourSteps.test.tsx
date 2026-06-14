import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { UserRole } from '../../../types';

/**
 * Specs for useTourSteps — picks the tour config by the current user's
 * role and translates each step via a role+index-derived i18n key.
 * ADMIN and MANAGER share the admin tour; an unknown/absent role yields
 * an empty config. We mock the auth store + useTranslation so we can
 * assert the role→tour mapping and that titles/contents are the
 * translated values for the expected keys.
 */

let role: UserRole | undefined;
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (s: any) => unknown) => selector({ user: role ? { role } : undefined }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Echo the resolved step key so we can assert the mapping deterministically.
    t: (key: string) => `T(${key})`,
  }),
}));

import { useTourSteps } from './useTourSteps';

beforeEach(() => {
  role = undefined;
});

describe('useTourSteps — role routing', () => {
  it('returns an empty config when there is no user role', () => {
    const { result } = renderHook(() => useTourSteps());
    expect(result.current.tourConfig).toBeNull();
    expect(result.current.tourId).toBeNull();
    expect(result.current.steps).toEqual([]);
  });

  it('maps ADMIN to the admin tour (12 steps)', () => {
    role = UserRole.ADMIN;
    const { result } = renderHook(() => useTourSteps());
    expect(result.current.tourId).toBe('admin-tour');
    expect(result.current.tourConfig?.name).toBe('Admin Tour');
    expect(result.current.steps).toHaveLength(12);
  });

  it('maps MANAGER to the SAME admin tour', () => {
    role = UserRole.MANAGER;
    const { result } = renderHook(() => useTourSteps());
    expect(result.current.tourId).toBe('admin-tour');
  });

  it('maps WAITER to the waiter tour (5 steps)', () => {
    role = UserRole.WAITER;
    const { result } = renderHook(() => useTourSteps());
    expect(result.current.tourId).toBe('waiter-tour');
    expect(result.current.steps).toHaveLength(5);
  });

  it('maps KITCHEN to the kitchen tour (5 steps)', () => {
    role = UserRole.KITCHEN;
    const { result } = renderHook(() => useTourSteps());
    expect(result.current.tourId).toBe('kitchen-tour');
    expect(result.current.steps).toHaveLength(5);
  });

  it('returns empty for a role without a tour (COURIER)', () => {
    role = UserRole.COURIER;
    const { result } = renderHook(() => useTourSteps());
    expect(result.current.tourConfig).toBeNull();
  });
});

describe('useTourSteps — step translation', () => {
  it("translates the admin tour's first step using the dashboard.welcome key", () => {
    role = UserRole.ADMIN;
    const { result } = renderHook(() => useTourSteps());
    expect(result.current.steps[0].title).toBe('T(steps.dashboard.welcome.title)');
    expect(result.current.steps[0].content).toBe('T(steps.dashboard.welcome.content)');
  });

  it('preserves the underlying step targets while overlaying translated copy', () => {
    role = UserRole.WAITER;
    const { result } = renderHook(() => useTourSteps());
    // First waiter step targets the dashboard container.
    expect(result.current.steps[0].target).toBe('[data-tour="dashboard-container"]');
    expect(result.current.steps[0].title).toBe('T(steps.dashboard.welcome.title)');
  });
});
