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
