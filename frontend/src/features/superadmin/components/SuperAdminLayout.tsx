import { Outlet, Navigate } from 'react-router-dom';
import { useSuperAdminAuthStore } from '../../../store/superAdminAuthStore';
import SuperAdminSidebar from './SuperAdminSidebar';

export default function SuperAdminLayout() {
  const { isAuthenticated, requires2FA } = useSuperAdminAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/superadmin/login" replace />;
  }

  if (requires2FA) {
    return <Navigate to="/superadmin/2fa" replace />;
  }

  return (
    <div className="flex h-screen bg-zinc-50">
      <SuperAdminSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
