import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

/**
 * Server-side per-user onboarding/tour state, persisted so welcome/tour
 * dismissals follow the account across browsers/devices instead of living
 * only in this browser's localStorage (uiStore `ui-storage`).
 *
 * Contract (backend UsersController, both routes @SkipBranchScope so they fly
 * tenant-wide without an X-Branch-Id header):
 *   - GET   /users/me/onboarding -> OnboardingData
 *   - PATCH /users/me/onboarding  (UpdateOnboardingDto) -> OnboardingData
 * See backend/src/modules/users/users.controller.ts:188-203 +
 * services/user-onboarding.service.ts.
 */
export interface TourProgressEntry {
  completed?: boolean;
  lastStep?: number;
  completedAt?: string;
}

export interface OnboardingData {
  hasSeenWelcome: boolean;
  tourProgress: Record<string, TourProgressEntry>;
  skipAllTours: boolean;
}

export interface UpdateOnboardingPayload {
  hasSeenWelcome?: boolean;
  skipAllTours?: boolean;
  tourProgress?: Record<string, TourProgressEntry>;
}

const ONBOARDING_QUERY_KEY = ['onboarding', 'me'] as const;

/** Read the account's server-side onboarding state. Enabled-gated so callers
 *  can skip the fetch (e.g. while exploring the shared demo restaurant). */
export const useOnboardingData = (enabled = true) => {
  return useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: async (): Promise<OnboardingData> => {
      const response = await api.get('/users/me/onboarding');
      return response.data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
};

/** Persist onboarding state to the account. Fire-and-forget at the call site —
 *  failures are swallowed (best-effort sync; localStorage stays the offline
 *  cache). */
export const useUpdateOnboarding = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: UpdateOnboardingPayload,
    ): Promise<OnboardingData> => {
      const response = await api.patch('/users/me/onboarding', payload);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(ONBOARDING_QUERY_KEY, data);
    },
  });
};
