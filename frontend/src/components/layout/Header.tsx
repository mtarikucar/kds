import { LogOut, User, Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useLogout } from '../../features/auth/authApi';
import Button from '../ui/Button';
import NotificationCenter from '../NotificationCenter';

interface HeaderProps {
  onMenuClick: () => void;
}

const Header = ({ onMenuClick }: HeaderProps) => {
  const user = useAuthStore((state) => state.user);
  const { mutate: logout, isPending } = useLogout();

  return (
    <header className="bg-white border-b border-gray-200 px-4 md:px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Hamburger menu button - visible only on mobile */}
          <button
            onClick={onMenuClick}
            className="md:hidden text-gray-600 hover:text-gray-900"
            aria-label="Open menu"
          >
            <Menu className="h-6 w-6" />
          </button>

          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Restaurant POS</h1>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          {/* Notification Center */}
          <NotificationCenter />

          {/* User Profile */}
          <Link to="/profile" className="flex items-center gap-2 hover:bg-gray-100 px-2 md:px-3 py-2 rounded-lg transition">
            <User className="h-5 w-5 text-gray-600" />
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-gray-900">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-gray-500 capitalize">
                {user?.role.replace('_', ' ')}
              </p>
            </div>
          </Link>

          <Button
            variant="outline"
            size="sm"
            onClick={() => logout()}
            isLoading={isPending}
            className="hidden sm:flex"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>

          {/* Mobile logout button - icon only */}
          <Button
            variant="outline"
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
