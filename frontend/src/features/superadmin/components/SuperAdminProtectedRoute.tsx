import { Navigate, Outlet } from 'react-router-dom';
import { useSuperAdminAuthStore } from '../../../store/superAdminAuthStore';

export default function SuperAdminProtectedRoute() {
  const { isAuthenticated, requires2FA } = useSuperAdminAuthStore();

  if (!isAuthenticated && !requires2FA) {
    return <Navigate to="/superadmin/login" replace />;
  }

  if (requires2FA) {
    return <Navigate to="/superadmin/2fa" replace />;
  }

  return <Outlet />;
}
