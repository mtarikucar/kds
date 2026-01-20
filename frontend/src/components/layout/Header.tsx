import { useState, useRef, useEffect } from 'react';
import { LogOut, User, Menu, Settings, ChevronDown, Home } from 'lucide-react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { useLogout } from '../../features/auth/authApi';
import Button from '../ui/Button';
import NotificationCenter from '../NotificationCenter';
import LanguageSwitcher from '../LanguageSwitcher';
import { cn } from '../../lib/utils';

interface HeaderProps {
  onMenuClick?: () => void;
}

const Header = ({ onMenuClick }: HeaderProps) => {
  const { t } = useTranslation('common');
  const user = useAuthStore((state) => state.user);
  const { mutate: logout, isPending } = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  
  // Show home button when not on home page
  const showHomeButton = location.pathname !== '/home';

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };

    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [userMenuOpen]);

  return (
    <header className="bg-card border-b border-border px-4 md:px-6 py-4 shadow-sm sticky top-0 z-40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Home Button - Show when not on home page */}
          {showHomeButton && (
            <button
              onClick={() => navigate('/home')}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-neutral-100 rounded-lg transition-colors duration-150"
              title={t('goToHome', 'Ana Sayfaya Dön')}
            >
              <Home className="h-4 w-4" />
              <span className="hidden sm:inline">{t('goToHome', 'Ana Sayfa')}</span>
            </button>
          )}
          {/* Hamburger menu button - visible only on mobile */}
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className="md:hidden text-neutral-600 hover:text-primary-500 transition-colors duration-150 p-2 rounded-lg hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              aria-label="Open menu"
            >
              <Menu className="h-6 w-6" />
            </button>
          )}

          <h1 className="text-xl md:text-2xl font-bold font-heading text-foreground">{t('app.name')}</h1>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          {/* Language Switcher */}
          <LanguageSwitcher />

          {/* Notification Center */}
          <NotificationCenter />

          {/* User Menu */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 hover:bg-neutral-100 px-2 md:px-3 py-2 rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              aria-label="User menu"
              aria-expanded={userMenuOpen}
            >
              <div className="h-8 w-8 rounded-full bg-primary-500 flex items-center justify-center text-white font-semibold text-sm">
                {user?.firstName?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium text-foreground">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-muted-foreground capitalize">
                  {user?.role.replace('_', ' ')}
                </p>
              </div>
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-muted-foreground hidden sm:block transition-transform duration-150',
                  userMenuOpen && 'rotate-180'
                )}
              />
            </button>

            {/* User Dropdown Menu */}
            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-card border border-border rounded-lg shadow-lg py-1 z-50 animate-in fade-in-0 zoom-in-95 duration-150">
                <Link
                  to="/profile"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-2 text-sm text-foreground hover:bg-neutral-100 transition-colors duration-150"
                >
                  <User className="h-4 w-4" />
                  {t('app.profile')}
                </Link>
                <Link
                  to="/admin/settings/subscription"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-2 text-sm text-foreground hover:bg-neutral-100 transition-colors duration-150"
                >
                  <Settings className="h-4 w-4" />
                  {t('navigation.settings')}
                </Link>
                <div className="border-t border-border my-1" />
                <button
                  onClick={() => {
                    logout();
                    setUserMenuOpen(false);
                  }}
                  disabled={isPending}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-error hover:bg-error-light transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <LogOut className="h-4 w-4" />
                  {t('app.logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
