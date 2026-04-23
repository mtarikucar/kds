import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { API_URL } from './env';

const API_BASE_URL = API_URL;

// withCredentials: true so the httpOnly refresh cookie is sent on
// /auth/refresh and /auth/logout (backend sets it on /api/auth path).
export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add access token
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// Single-flight refresh: when N requests receive 401 in parallel (common on
// page load where every dashboard hook fires at once), we must NOT fire N
// concurrent /auth/refresh calls. The second through Nth would either
// - race against the first rotation, invalidating the fresh token, or
// - trip the backend's refresh-reuse revocation and log the user out.
// All concurrent 401s now await the same in-flight promise, then retry with
// whatever access token that single refresh produced.
let refreshInFlight: Promise<string> | null = null;

function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = axios
    .post(
      `${API_BASE_URL}/auth/refresh`,
      {},
      { withCredentials: true },
    )
    .then((response) => {
      const { accessToken } = response.data;
      useAuthStore.getState().setAccessToken(accessToken);
      return accessToken as string;
    })
    .finally(() => {
      // Clear the slot only after the promise settles so late-arriving 401s
      // during the same tick join this round; the next tick starts fresh.
      refreshInFlight = null;
    });
  return refreshInFlight;
}

// Response interceptor: on 401, try a single refresh using the cookie.
// If that also fails, clear the store and bounce to login.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const accessToken = await refreshAccessToken();
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        useAuthStore.getState().logout();
        window.location.href = import.meta.env.BASE_URL + 'login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

export default api;
