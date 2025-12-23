import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { LoginRequest, RegisterRequest, AuthResponse, User } from '../../types';

export const useLogin = () => {
  const login = useAuthStore((state) => state.login);

  return useMutation({
    mutationFn: async (data: LoginRequest): Promise<AuthResponse> => {
      const response = await api.post('/auth/login', data);
      return response.data;
    },
    onSuccess: (data) => {
      login(data.user, data.accessToken, data.refreshToken);
      toast.success(i18n.t('common:notifications.loginSuccessful'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.loginFailed'));
    },
  });
};

export const useRegister = () => {
  return useMutation({
    mutationFn: async (data: RegisterRequest): Promise<AuthResponse> => {
      const response = await api.post('/auth/register', data);
      return response.data;
    },
    onSuccess: () => {
      toast.success(i18n.t('common:notifications.registrationSuccessful'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.registrationFailed'));
    },
  });
};

export const useProfile = () => {
  const setUser = useAuthStore((state) => state.setUser);

  return useQuery({
    queryKey: ['profile'],
    queryFn: async (): Promise<User> => {
      const response = await api.get('/auth/profile');
      // Update auth store with fresh user data (including emailVerified status)
      setUser(response.data);
      return response.data;
    },
    enabled: !!useAuthStore.getState().accessToken,
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
      queryClient.clear();
      toast.success(i18n.t('common:notifications.logoutSuccessful'));
    },
    onError: () => {
      // Logout anyway even if API call fails
      logout();
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
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
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
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useChangePassword = () => {
  return useMutation({
    mutationFn: async (data: { oldPassword: string; newPassword: string }): Promise<{ message: string }> => {
      const response = await api.post('/auth/change-password', data);
      return response.data;
    },
    onSuccess: () => {
      toast.success(i18n.t('common:notifications.passwordChangedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useVerifyEmail = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (code: string): Promise<{ message: string; verified: boolean }> => {
      const response = await api.post('/auth/verify-email', { code });
      return response.data;
    },
    onSuccess: () => {
      toast.success(i18n.t('common:notifications.emailVerifiedSuccessfully'));
      // Invalidate profile query to refresh email verified status
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
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
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

// Google OAuth Hook
export const useGoogleAuth = () => {
  const login = useAuthStore((state) => state.login);

  return useMutation({
    mutationFn: async (credential: string): Promise<AuthResponse> => {
      const response = await api.post('/auth/google', { credential });
      return response.data;
    },
    onSuccess: (data) => {
      login(data.user, data.accessToken, data.refreshToken);
      toast.success(i18n.t('common:notifications.googleLoginSuccessful'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.loginFailed'));
    },
  });
};

// Apple Sign-In Hook
export const useAppleAuth = () => {
  const login = useAuthStore((state) => state.login);

  return useMutation({
    mutationFn: async (data: { identityToken: string; firstName?: string; lastName?: string }): Promise<AuthResponse> => {
      const response = await api.post('/auth/apple', data);
      return response.data;
    },
    onSuccess: (data) => {
      login(data.user, data.accessToken, data.refreshToken);
      toast.success(i18n.t('common:notifications.appleLoginSuccessful'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.loginFailed'));
    },
  });
};
