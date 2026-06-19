import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import { getApiErrorMessage } from '../../lib/api-error';
import { useAuthStore } from '../../store/authStore';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import { LoginRequest, RegisterRequest, AuthResponse, User } from '../../types';

export const useLogin = () => {
  const login = useAuthStore((state) => state.login);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: LoginRequest): Promise<AuthResponse> => {
      const response = await api.post('/auth/login', data);
      return response.data;
    },
    onSuccess: (data) => {
      // v2.8.91: clear React Query cache on every login so a previous
      // tenant's entitlements / subscription / quotas don't bleed into
      // the next session. Pre-v2.8.91 a tenant A login → logout →
      // tenant B login on the same device kept tenant A's
      // effective-features in cache for up to 30s (or longer for
      // queries with 5min staleTime), which was both a privacy leak
      // and a correctness bug (FeatureGate could grant access tenant
      // B never paid for).
      queryClient.clear();
      // refresh token is stored by the backend as an httpOnly cookie
      login(data.user, data.accessToken);
      toast.success(i18n.t('common:notifications.loginSuccessful'));
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.loginFailed')));
    },
  });
};

interface RegisterResponse extends AuthResponse {
  pendingApproval?: boolean;
  message?: string;
}

export const useRegister = () => {
  return useMutation({
    mutationFn: async (data: RegisterRequest): Promise<RegisterResponse> => {
      const response = await api.post('/auth/register', data);
      return response.data;
    },
    onSuccess: (data) => {
      if (data.pendingApproval) {
        toast.success(data.message || i18n.t('common:notifications.registrationPendingApproval'));
      } else {
        toast.success(i18n.t('common:notifications.registrationSuccessful'));
      }
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.registrationFailed')));
    },
  });
};

export const useProfile = () => {
  const setUser = useAuthStore((state) => state.setUser);
  // v2.8.94 — subscribe to accessToken so the `enabled` flag re-evaluates
  // when the user logs in/out within a long-lived SPA session (pre-fix
  // `useAuthStore.getState().accessToken` was a one-time snapshot, so a
  // mount-time-null token never re-armed the query after a later login).
  // Also key on user.id + user.tenantId so a tenant switch (or any
  // user-context shift) produces a distinct cache entry instead of
  // serving the previous tenant's cached profile.
  const accessToken = useAuthStore((state) => state.accessToken);
  const userId = useAuthStore((state) => state.user?.id);
  const tenantId = useAuthStore((state) => state.user?.tenantId);

  return useQuery({
    queryKey: ['profile', userId, tenantId],
    queryFn: async (): Promise<User> => {
      const response = await api.get('/auth/profile');
      // Update auth store with fresh user data (including emailVerified status)
      setUser(response.data);
      return response.data;
    },
    enabled: !!accessToken,
  });
};

export interface CompleteProfilePayload {
  phone: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  taxId?: string;
  taxOffice?: string;
  addressLine?: string;
  city?: string;
  timezone?: string;
  locale?: string;
}

/**
 * Post-social-login (and any incomplete-profile) onboarding submit. Saves the
 * required phone + optional business details, then refreshes the cached profile
 * so the ProfileCompletionGate releases into the app.
 */
export const useCompleteProfile = () => {
  const setUser = useAuthStore((state) => state.setUser);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CompleteProfilePayload): Promise<User> => {
      const response = await api.post('/auth/complete-profile', payload);
      return response.data;
    },
    onSuccess: (user) => {
      setUser(user);
      qc.invalidateQueries({ queryKey: ['profile'] });
      toast.success(
        i18n.t('auth:welcome.saved', { defaultValue: 'Bilgileriniz kaydedildi.' }),
      );
    },
    onError: (e) =>
      toast.error(
        getApiErrorMessage(
          e,
          i18n.t('auth:welcome.saveFailed', { defaultValue: 'Kaydedilemedi' }),
        ),
      ),
  });
};

export const useLogout = () => {
  const logout = useAuthStore((state) => state.logout);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await api.post('/auth/logout');
    },
    onSuccess: () => {
      logout();
      // deep-review FL1: mirror the 401-interceptor cleanup (lib/api.ts)
      // so a user-initiated logout also drops the persisted branch scope.
      // Otherwise a same-tenant account switch on a shared device leaves
      // the prior session's branchId/allowedBranchIds in localStorage
      // until App's hydrateFromUser effect later re-scopes it.
      try {
        useBranchScopeStore.getState().clear();
      } catch {
        // storage/hydration race — non-fatal
      }
      queryClient.clear();
      toast.success(i18n.t('common:notifications.logoutSuccessful'));
    },
    onError: () => {
      // Logout anyway even if API call fails
      logout();
      // deep-review FL1: clear branch scope here too — see onSuccess.
      try {
        useBranchScopeStore.getState().clear();
      } catch {
        // non-fatal
      }
      queryClient.clear();
    },
  });
};

export const useForgotPassword = () => {
  return useMutation({
    mutationFn: async (email: string): Promise<{ message: string }> => {
      const response = await api.post('/auth/forgot-password', { email });
      return response.data;
    },
    onSuccess: () => {
      toast.success(i18n.t('common:notifications.passwordResetLinkSent'));
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
    },
  });
};

export const useResetPassword = () => {
  return useMutation({
    mutationFn: async (data: { token: string; newPassword: string }): Promise<{ message: string }> => {
      const response = await api.post('/auth/reset-password', data);
      return response.data;
    },
    onSuccess: () => {
      toast.success(i18n.t('common:notifications.passwordResetSuccessful'));
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
    },
  });
};

export const useChangePassword = () => {
  return useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }): Promise<{ message: string }> => {
      const response = await api.post('/auth/change-password', data);
      return response.data;
    },
    onSuccess: () => {
      toast.success(i18n.t('common:notifications.passwordChangedSuccessfully'));
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
    },
  });
};

export const useVerifyEmail = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { email: string; code: string }): Promise<{ message: string; verified: boolean }> => {
      const response = await api.post('/auth/verify-email', data);
      return response.data;
    },
    onSuccess: () => {
      toast.success(i18n.t('common:notifications.emailVerifiedSuccessfully'));
      // Invalidate profile query to refresh email verified status
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
    },
  });
};

export const useResendVerificationEmail = () => {
  return useMutation({
    mutationFn: async (): Promise<{ message: string; codeExpiry: Date }> => {
      const response = await api.post('/auth/resend-verification');
      return response.data;
    },
    onSuccess: () => {
      toast.success(i18n.t('common:notifications.verificationCodeSent'));
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
    },
  });
};

// Google OAuth Hook
export const useGoogleAuth = () => {
  const login = useAuthStore((state) => state.login);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (credential: string): Promise<AuthResponse> => {
      const response = await api.post('/auth/google', { credential });
      return response.data;
    },
    onSuccess: (data) => {
      // v2.8.94 — mirror useLogin's cache clear so a prior-tenant
      // session's cached entitlements / quotas / subscription don't
      // bleed into the OAuth sign-in. Pre-fix only the email/password
      // path clear()'d, so a "switch accounts via Google" flow on a
      // shared device kept the previous tenant's FeatureGate state
      // until the queries naturally re-fetched (up to 30s, or 5min
      // for staleTime-pinned queries).
      queryClient.clear();
      login(data.user, data.accessToken);
      toast.success(i18n.t('common:notifications.googleLoginSuccessful'));
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.loginFailed')));
    },
  });
};

// Apple Sign-In Hook
export const useAppleAuth = () => {
  const login = useAuthStore((state) => state.login);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { identityToken: string; firstName?: string; lastName?: string }): Promise<AuthResponse> => {
      const response = await api.post('/auth/apple', data);
      return response.data;
    },
    onSuccess: (data) => {
      // v2.8.94 — see useGoogleAuth above; same cross-tenant cache
      // leak vector.
      queryClient.clear();
      login(data.user, data.accessToken);
      toast.success(i18n.t('common:notifications.appleLoginSuccessful'));
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.loginFailed')));
    },
  });
};
