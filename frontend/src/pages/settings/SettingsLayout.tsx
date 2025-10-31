import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings, CreditCard, Monitor, Plug } from 'lucide-react';

const SettingsLayout = () => {
  const { t } = useTranslation('settings');
  const location = useLocation();

  const settingsNavItems = [
    {
      to: '/admin/settings/subscription',
      icon: CreditCard,
      label: t('subscription'),
      description: t('subscriptionDesc'),
    },
    {
      to: '/admin/settings/pos',
      icon: Monitor,
      label: t('pos'),
      description: t('posDesc'),
    },
    {
      to: '/admin/settings/integrations',
  icon: Plug,
  label: t('integrationsLabel'),
      description: t('integrationsDesc'),
    },
  ];

  return (
    <div className="h-full flex">
      {/* Settings Sidebar */}
      <div className="w-72 bg-gray-50 border-r border-gray-200 p-6">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Settings className="h-6 w-6 text-gray-700" />
            <h2 className="text-xl font-bold text-gray-900">{t('title')}</h2>
          </div>
          <p className="text-sm text-gray-600">
            {t('manageConfiguration')}
          </p>
        </div>

        <nav className="space-y-1">
          {settingsNavItems.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`flex items-start gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <item.icon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
                  isActive ? 'text-blue-600' : 'text-gray-500'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className={`font-medium ${isActive ? 'text-blue-700' : 'text-gray-900'}`}>
                    {item.label}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    {item.description}
                  </div>
                </div>
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>{t('tip')}:</strong> {t('tipDescription')}
          </p>
        </div>
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
};

export default SettingsLayout;
