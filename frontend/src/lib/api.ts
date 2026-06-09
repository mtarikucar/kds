import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { useBranchScopeStore } from '../store/branchScopeStore';
import { API_URL } from './env';

/**
 * v3.0.0 strict — endpoints that legitimately operate above the
 * branch axis. The interceptor below allows requests to these
 * prefixes to fly without an X-Branch-Id header; everything else
 * gets fail-fast if branchScopeStore hasn't resolved a branchId.
 */
const TENANT_WIDE_PATH_PREFIXES = [
  '/auth/',
  '/billing/',
  '/branches',
  '/me',
  '/superadmin/',
];

function isTenantWidePath(url: string | undefined): boolean {
  if (!url) return false;
  return TENANT_WIDE_PATH_PREFIXES.some((p) => url.includes(p));
}

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

// Request interceptor — attaches the access token and the
// X-Branch-Id header.
//
// v3.0.0 strict semantics:
//   - For branch-scoped routes (everything not in TENANT_WIDE_PATH_
//     PREFIXES), branchId MUST be resolved. If not, the request is
//     rejected client-side before the network call — saves a
//     server-side 400 round trip and surfaces the missing-scope bug
//     at the call site.
//   - For tenant-wide routes the header is omitted (the backend
//     ignores it anyway on @SkipBranchScope() handlers, but
//     omitting keeps the wire clean).
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const tenantWide = isTenantWidePath(config.url);
    if (!tenantWide) {
      const branchId = useBranchScopeStore.getState().branchId;
      if (!branchId) {
        return Promise.reject(
          new Error(
            'Branch scope not resolved; cannot send branch-scoped request',
          ),
        );
      }
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
        // v3.0.0 — drop the persisted branch scope on logout so a
        // fresh login on the same device gets a clean slate.
        try {
          useBranchScopeStore.getState().clear();
        } catch {
          // Storage unavailable / store hydration race — non-fatal.
        }
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
