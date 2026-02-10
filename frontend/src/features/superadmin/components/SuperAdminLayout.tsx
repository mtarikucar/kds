import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useSuperAdminAuthStore } from '../../../store/superAdminAuthStore';
import SuperAdminSidebar from './SuperAdminSidebar';

const FULL_BLEED_ROUTES = ['/superadmin/terminal'];

export default function SuperAdminLayout() {
  const { isAuthenticated, requires2FA } = useSuperAdminAuthStore();
  const { pathname } = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/superadmin/login" replace />;
  }

  if (requires2FA) {
    return <Navigate to="/superadmin/2fa" replace />;
  }

  const isFullBleed = FULL_BLEED_ROUTES.includes(pathname);

  return (
    <div className="flex h-screen bg-zinc-50">
      <SuperAdminSidebar />
      <main className="flex-1 overflow-hidden">
        {isFullBleed ? (
          <Outlet />
        ) : (
          <div className="h-full overflow-y-auto">
            <div className="max-w-7xl mx-auto px-8 py-8">
              <Outlet />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
