import { LogOut, User, Menu, Store } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { useLogout } from '../../features/auth/authApi';
import Button from '../ui/Button';
import NotificationCenter from '../NotificationCenter';
import LanguageSwitcher from '../LanguageSwitcher';
import { MascotButton } from '../../features/onboarding';
import BranchPicker from './BranchPicker';
import { useUiStore } from '../../store/uiStore';

interface HeaderProps {
  onMenuClick: () => void;
}

const Header = ({ onMenuClick }: HeaderProps) => {
  const { t } = useTranslation('common');
  const user = useAuthStore((state) => state.user);
  const demoMode = useAuthStore((state) => state.demoMode);
  const { mutate: logout, isPending } = useLogout();
  const isSidebarCollapsed = useUiStore((state) => state.isSidebarCollapsed);

  return (
    <header className="bg-white border-b border-slate-200/60 px-3 sm:px-4 md:px-6 lg:px-8 py-3 md:py-4 sticky top-0 z-30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
          {/* Hamburger menu button - visible only on mobile */}
          <button
            onClick={onMenuClick}
            className="md:hidden flex-shrink-0 text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-2 rounded-lg transition-all duration-150"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* The sidebar carries the same wordmark whenever it is docked and
              expanded, which is exactly the md-to-lg band where the header
              has the least room — so drop the duplicate there rather than
              truncate it to "Hum…". Below md the sidebar is off-canvas, and
              when it is collapsed to icons its wordmark is hidden; in both
              cases this is the only brand on screen, so it stays. */}
          <h1
            className={`text-lg sm:text-xl md:text-2xl font-heading font-bold text-slate-900 truncate ${
              isSidebarCollapsed ? '' : 'md:hidden lg:block'
            }`}
          >
            {t('app.name')}
          </h1>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 md:gap-3 flex-shrink-0">
          {/* v2.8.88: branch picker (UI-only this PR; hides when not
              multi-branch). Sits left of LanguageSwitcher so it's
              prominent on desktop. */}
          <BranchPicker />

          {/* Language Switcher */}
          <LanguageSwitcher />

          {/* Mağaza (store hub) — add-ons + hardware + orders. ADMIN/MANAGER
              only; moved here from the sidebar so it's reachable anywhere.
              Hidden entirely for demo-tenant sessions — the store hub is
              nothing but real-money purchases, which the backend 403s
              (DEMO_PAYMENT_BLOCKED) for the shared demo tenant. */}
          {!demoMode && (user?.role === 'ADMIN' || user?.role === 'MANAGER') && (
            <Link
              to="/admin/store"
              aria-label={t('hummytummy.storeHub.title', { defaultValue: 'Mağaza' })}
              title={t('hummytummy.storeHub.title', { defaultValue: 'Mağaza' })}
              className="flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-2 rounded-lg transition-all duration-150"
            >
              <Store className="h-5 w-5" />
            </Link>
          )}

          {/* Notification Center */}
          <div data-tour="notifications">
            <NotificationCenter />
          </div>

          {/* Mascot Button - hidden on very small screens to preserve logout */}
          <div className="hidden sm:block">
            <MascotButton />
          </div>

          {/* User Profile */}
          <Link
            to="/profile"
            className="flex items-center gap-3 hover:bg-slate-50 px-2 lg:px-3 py-2 rounded-lg transition-all duration-150 border border-transparent hover:border-slate-200 shrink-0"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500/10 to-primary-500/5 ring-1 ring-primary-500/20 flex items-center justify-center flex-shrink-0">
              <User className="h-4 w-4 text-primary-600" />
            </div>
            {/* Name + role only from lg up. At the md band the sidebar is
                already docked (256px), so the header has ~460px to work with
                and this block plus the logout label used to push the cluster
                ~90px past the right edge — where the shell clips it and the
                logout button becomes unclickable. */}
            <div className="hidden lg:block">
              <p className="text-sm font-medium text-slate-900">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-slate-500 capitalize">
                {user?.role.replace('_', ' ')}
              </p>
            </div>
          </Link>

          {/* Desktop logout button (with label) */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout()}
            isLoading={isPending}
            className="hidden lg:flex text-slate-600 hover:text-slate-900"
          >
            <LogOut className="h-4 w-4 mr-2" />
            {t('app.logout')}
          </Button>

          {/* Mobile/tablet logout button - icon only */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout()}
            isLoading={isPending}
            className="lg:hidden p-2"
            aria-label={t('app.logout')}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
};

export default Header;
