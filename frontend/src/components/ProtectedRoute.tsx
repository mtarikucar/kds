import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '../types';
import { API_URL } from '../lib/env';
import Spinner from './ui/Spinner';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
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
    axios
      .post(`${API_URL}/auth/refresh`, {}, { withCredentials: true, timeout: 10_000 })
      .then((res) => {
        if (cancelled) return;
        setAccessToken(res.data.accessToken);
      })
      .catch(() => {
        if (cancelled) return;
        logout();
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
    return <Navigate to="/login" replace />;
  }

  if (bootstrapping) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" />
      </div>
    );
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
