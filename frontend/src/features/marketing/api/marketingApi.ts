import axios from 'axios';
import { useMarketingAuthStore } from '../../../store/marketingAuthStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const marketingApi = axios.create({
  baseURL: `${API_URL}/marketing`,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor - add auth token
marketingApi.interceptors.request.use((config) => {
  const { accessToken } = useMarketingAuthStore.getState();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Response interceptor - handle token refresh
marketingApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const { refreshToken, setAccessToken, logout } =
        useMarketingAuthStore.getState();

      if (!refreshToken) {
        logout();
        return Promise.reject(error);
      }

      try {
        const response = await axios.post(`${API_URL}/marketing/auth/refresh`, {
          refreshToken,
        });

        const { accessToken } = response.data;
        setAccessToken(accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return marketingApi(originalRequest);
      } catch {
        logout();
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

export default marketingApi;
