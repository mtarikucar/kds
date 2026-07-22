import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import Button from './ui/Button';

/**
 * Rendered by ProtectedRoute when the authenticated user's `role` fails
 * `isValidUserRole` (backend counterpart: JwtStrategy.validate() 401
 * ACCOUNT_ROLE_INVALID). This can only happen for a row planted directly
 * in Postgres bypassing the app's own @IsEnum(UserRole) write-path
 * validation — see `users_role_valid` CHECK constraint + the
 * PATCH /superadmin/users/:id/role recovery tool.
 *
 * Replaces the app shell entirely (including Sidebar, which would
 * otherwise silently filter out every nav item and render empty) with an
 * explicit, translated explanation instead of a mysterious blank screen
 * or login bounce. The only available action is logging out — there is
 * nothing the user themself can fix; a support engineer must correct the
 * role via the superadmin tool above.
 */
const AccountRoleInvalid = () => {
  const { t } = useTranslation(['errors', 'common']);

  const handleLogout = () => {
    useAuthStore.getState().logout();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md w-full text-center bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
          <AlertTriangle className="h-8 w-8 text-amber-600" aria-hidden="true" />
        </div>

        <h1 className="text-xl font-bold text-slate-900 mb-2">
          {t('errors:pages.accountRoleInvalid.title')}
        </h1>
        <p className="text-slate-600 mb-8">
          {t('errors:pages.accountRoleInvalid.description')}
        </p>

        <Button variant="primary" className="w-full" onClick={handleLogout}>
          {t('common:app.logout')}
        </Button>
      </div>
    </div>
  );
};

export default AccountRoleInvalid;
