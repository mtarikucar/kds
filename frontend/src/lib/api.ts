import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
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

// Request interceptor to add access token and the active branch hint.
//
// v3.0.0 — every authenticated request carries `X-Branch-Id` when the
// user has picked an active branch via BranchPicker. The backend's
// BranchGuard prefers the header over the JWT's `activeBranchId`
// claim, so switching branches via the picker has zero token-refresh
// cost. WAITER / KITCHEN / COURIER are auto-pinned to their primary
// branch by the store (they can't switch), so this still sends — but
// to a fixed value.
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const branchId = useUiStore.getState().activeBranchId;
    if (branchId) {
      config.headers['X-Branch-Id'] = branchId;
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

// Bound the refresh round so a hung /auth/refresh (network stall, server
// pause) can't permanently block every queued 401 retry. 10s comfortably
// exceeds the backend's own request timeout while still failing the
// queue fast enough to bounce to /login.
const REFRESH_TIMEOUT_MS = 10_000;

function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;
  const refresh = axios
    .post(
      `${API_BASE_URL}/auth/refresh`,
      {},
      { withCredentials: true, timeout: REFRESH_TIMEOUT_MS },
    )
    .then((response) => {
      const { accessToken } = response.data;
      useAuthStore.getState().setAccessToken(accessToken);
      return accessToken as string;
    });
  const timeout = new Promise<string>((_, reject) =>
    setTimeout(
      () => reject(new Error('refresh timeout')),
      REFRESH_TIMEOUT_MS,
    ),
  );
  refreshInFlight = Promise.race([refresh, timeout]).finally(() => {
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
        // Capture the user's current path so LoginPage can redirect
        // them back after re-authentication. `window.location.href`
        // does a full page load that wipes React Router's history.state,
        // so we hop via sessionStorage — LoginPage reads + clears it
        // on mount. Same internal-path validation runs there.
        try {
          if (typeof window !== 'undefined' && window.location) {
            const here = window.location.pathname + window.location.search + window.location.hash;
            // Skip if we're already on /login (or about to be) — no
            // need to bounce back to ourselves.
            if (here && !here.startsWith('/login')) {
              window.sessionStorage.setItem('postLoginReturn', here);
            }
          }
        } catch {
          // sessionStorage can throw in private-mode / cross-origin
          // sandbox iframes — non-fatal, fall through to /dashboard.
        }
        window.location.href = import.meta.env.BASE_URL + 'login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

export default api;
