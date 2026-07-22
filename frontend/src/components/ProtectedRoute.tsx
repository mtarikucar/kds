import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '../types';
import { isValidUserRole } from '../types/roles';
import { API_URL } from '../lib/env';
import Spinner from './ui/Spinner';
import AccountRoleInvalid from './AccountRoleInvalid';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

// Module-scoped promise: dedupes the bootstrap refresh across StrictMode's
// double-effect invocation (and across multiple ProtectedRoute mounts
// that may share the same "no accessToken" window). Without this, the
// backend sees the rotating refresh-token used twice and treats the
// second hit as token reuse → revokes the whole family.
let inflightRefresh: Promise<{ accessToken: string } | null> | null = null;

function bootstrapAccessToken(): Promise<{ accessToken: string } | null> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = axios
    .post(`${API_URL}/auth/refresh`, {}, { withCredentials: true, timeout: 10_000 })
    .then((res) => ({ accessToken: res.data.accessToken as string }))
    .catch(() => null)
    .finally(() => {
      // Clear once settled so a later refresh (after another logout
      // cycle) can re-arm. The successful token is already in the store.
      setTimeout(() => {
        inflightRefresh = null;
      }, 0);
    });
  return inflightRefresh;
}

// On reload `isAuthenticated` rehydrates from persisted state but
// `accessToken` does not (memory-only by design). The old version
// rendered children immediately and waited for the first 401 to
// trigger refresh — that caused a visible flicker plus a double-fetch
// of every initial dashboard hook. We now block render until the
// refresh resolves, treating a refresh failure as "session expired".
const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
  const { isAuthenticated, user, accessToken, setAccessToken, logout } =
    useAuthStore();
  const location = useLocation();
  const [bootstrapping, setBootstrapping] = useState(
    isAuthenticated && !accessToken,
  );

  useEffect(() => {
    if (!isAuthenticated || accessToken) {
      setBootstrapping(false);
      return;
    }
    let cancelled = false;
    setBootstrapping(true);
    bootstrapAccessToken()
      .then((result) => {
        if (cancelled) return;
        if (result) setAccessToken(result.accessToken);
        else logout();
      })
      .finally(() => {
        if (cancelled) return;
        setBootstrapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, accessToken, setAccessToken, logout]);

  if (!isAuthenticated) {
    // Preserve the route the user was trying to reach (including any
    // query string like `?sku=…` from the landing storefront's
    // "Sipariş ver" CTA). LoginPage reads `state.from` for the post-
    // login redirect so deeplinks survive the auth bounce.
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: `${location.pathname}${location.search}${location.hash}`,
        }}
      />
    );
  }

  if (bootstrapping) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  // Structural role guard (mirrors JwtStrategy.validate()'s 401
  // ACCOUNT_ROLE_INVALID). Checked BEFORE the per-route allowedRoles gate
  // below — that gate would either silently bounce to /dashboard or (via
  // Sidebar's itemVisible) render an empty nav with no explanation. This
  // is the single highest-level wrapper around every authenticated route,
  // so replacing children here also removes the app shell (Sidebar) that
  // would otherwise render blank for an unrecognized role.
  if (user && !isValidUserRole(user.role)) {
    return <AccountRoleInvalid />;
  }

  // Check role-based access if allowedRoles is specified
  if (allowedRoles && user?.role) {
    const userRole = user.role as UserRole;
    if (!allowedRoles.includes(userRole)) {
      // Redirect to dashboard if user doesn't have required role
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
};

export default ProtectedRoute;
