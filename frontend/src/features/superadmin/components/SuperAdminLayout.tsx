import { useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu as MenuIcon } from 'lucide-react';
import { useSuperAdminAuthStore } from '../../../store/superAdminAuthStore';
import SuperAdminSidebar from './SuperAdminSidebar';

export default function SuperAdminLayout() {
  const { t } = useTranslation('superadmin');
  const { isAuthenticated, requires2FA } = useSuperAdminAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!isAuthenticated) {
    return <Navigate to="/superadmin/login" replace />;
  }

  if (requires2FA) {
    return <Navigate to="/superadmin/2fa" replace />;
  }

  return (
    <div className="flex h-screen bg-zinc-50">
      <SuperAdminSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar — the sidebar is an off-canvas drawer below lg, so
            the operator needs a hamburger to open it on phones/tablets. */}
        <header className="flex h-14 items-center gap-3 border-b border-zinc-200 bg-white px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100"
            aria-label={t('nav.openMenu', 'Menüyü aç')}
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900">
              <span className="text-xs font-semibold text-white">K</span>
            </div>
            <span className="font-semibold tracking-tight text-zinc-900">
              {t('brand')}
            </span>
          </div>
        </header>
        <main className="flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
