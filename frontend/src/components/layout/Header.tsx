import { LogOut, User, Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { useLogout } from '../../features/auth/authApi';
import Button from '../ui/Button';
import NotificationCenter from '../NotificationCenter';
import LanguageSwitcher from '../LanguageSwitcher';
import { MascotButton } from '../../features/onboarding';

interface HeaderProps {
  onMenuClick: () => void;
}

const Header = ({ onMenuClick }: HeaderProps) => {
  const { t } = useTranslation('common');
  const user = useAuthStore((state) => state.user);
  const { mutate: logout, isPending } = useLogout();

  return (
    <header className="bg-white border-b border-slate-200/60 px-4 md:px-6 lg:px-8 py-4 sticky top-0 z-30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Hamburger menu button - visible only on mobile */}
          <button
            onClick={onMenuClick}
            className="md:hidden text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-2 rounded-lg transition-all duration-150"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <h1 className="text-xl md:text-2xl font-heading font-bold text-slate-900">
            {t('app.name')}
          </h1>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          {/* Language Switcher */}
          <LanguageSwitcher />

          {/* Notification Center */}
          <div data-tour="notifications">
            <NotificationCenter />
          </div>

          {/* Mascot Button - Tour Guide */}
          <MascotButton />

          {/* User Profile */}
          <Link
            to="/profile"
            className="flex items-center gap-3 hover:bg-slate-50 px-3 py-2 rounded-lg transition-all duration-150 border border-transparent hover:border-slate-200"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500/10 to-primary-500/5 ring-1 ring-primary-500/20 flex items-center justify-center">
              <User className="h-4 w-4 text-primary-600" />
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-slate-900">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-slate-500 capitalize">
                {user?.role.replace('_', ' ')}
              </p>
            </div>
          </Link>

          {/* Desktop logout button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout()}
            isLoading={isPending}
            className="hidden sm:flex text-slate-600 hover:text-slate-900"
          >
            <LogOut className="h-4 w-4 mr-2" />
            {t('app.logout')}
          </Button>

          {/* Mobile logout button - icon only */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout()}
            isLoading={isPending}
            className="sm:hidden p-2"
            aria-label="Logout"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
};

export default Header;
