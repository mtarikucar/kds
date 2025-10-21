import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
      toast.success('Login successful');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Login failed');
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
      toast.success('Registration successful. Please login.');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Registration failed');
    },
  });
};

export const useProfile = () => {
  return useQuery({
    queryKey: ['profile'],
    queryFn: async (): Promise<User> => {
      const response = await api.get('/auth/profile');
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
      toast.success('Logged out successfully');
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
      toast.success('Password reset link sent to your email');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to send reset email');
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
      toast.success('Password reset successful. Please login with your new password.');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to reset password');
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
      toast.success('Password changed successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to change password');
    },
  });
};

export const useVerifyEmail = () => {
  return useMutation({
    mutationFn: async (token: string): Promise<{ message: string }> => {
      const response = await api.post('/auth/verify-email', { token });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Email verified successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Email verification failed');
    },
  });
};

export const useResendVerificationEmail = () => {
  return useMutation({
    mutationFn: async (): Promise<{ message: string }> => {
      const response = await api.post('/auth/resend-verification');
      return response.data;
    },
    onSuccess: () => {
      toast.success('Verification email sent');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to send verification email');
    },
  });
};
