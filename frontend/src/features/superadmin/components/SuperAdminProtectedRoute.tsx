import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useSuperAdminAuthStore } from '../../../store/superAdminAuthStore';
import { restoreSuperAdminSession } from '../api/superAdminApi';

export default function SuperAdminProtectedRoute() {
  const { isAuthenticated, requires2FA, accessToken } = useSuperAdminAuthStore();

  // On a page reload the store rehydrates `isAuthenticated` from localStorage
  // but the access/refresh tokens are intentionally NOT persisted (XSS
  // hardening). Silently re-mint the access token from the httpOnly refresh
  // cookie before deciding to bounce to /login — otherwise every reload kicked
  // the operator out.
  const needsRestore = isAuthenticated && !accessToken && !requires2FA;
  const [restoring, setRestoring] = useState(needsRestore);

  useEffect(() => {
    if (!needsRestore) return;
    let cancelled = false;
    restoreSuperAdminSession()
      .catch(() => {
        // No / expired refresh cookie → the session really is over.
        useSuperAdminAuthStore.getState().logout();
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
    // Run once on mount; subsequent token changes are driven by the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (requires2FA) {
    return <Navigate to="/superadmin/2fa" replace />;
  }

  if (restoring) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      </div>
    );
  }

  if (!isAuthenticated || !accessToken) {
    return <Navigate to="/superadmin/login" replace />;
  }

  return <Outlet />;
}
