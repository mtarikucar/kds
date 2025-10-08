import { LogOut, User } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useLogout } from '../../features/auth/authApi';
import Button from '../ui/Button';

const Header = () => {
  const user = useAuthStore((state) => state.user);
  const { mutate: logout, isPending } = useLogout();

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Restaurant POS</h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-gray-600" />
            <div>
              <p className="text-sm font-medium text-gray-900">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-gray-500 capitalize">
                {user?.role.replace('_', ' ')}
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => logout()}
            isLoading={isPending}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
};

export default Header;
