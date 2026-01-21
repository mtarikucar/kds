import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings, CreditCard, Monitor, Plug, Download, Menu, X } from 'lucide-react';

const SettingsLayout = () => {
  const { t } = useTranslation('settings');
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
      to: '/admin/settings/desktop',
      icon: Download,
      label: t('desktopApp'),
      description: t('desktopAppMenuDesc'),
    },
    {
      to: '/admin/settings/integrations',
      icon: Plug,
      label: t('integrationsLabel'),
      description: t('integrationsDesc'),
    },
  ];

  const handleNavClick = () => {
    setIsMobileMenuOpen(false);
  };

  const SidebarContent = () => (
    <>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Settings className="h-6 w-6 text-slate-700" />
          <h2 className="text-xl font-heading font-bold text-slate-900">{t('title')}</h2>
        </div>
        <p className="text-sm text-slate-500">
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
              onClick={handleNavClick}
              className={`flex items-start gap-3 px-4 py-3 rounded-xl transition-all duration-150 ${
                isActive
                  ? 'bg-primary-50 text-primary-700 border border-primary-200/60 shadow-sm'
                  : 'text-slate-700 hover:bg-slate-100/80'
              }`}
            >
              <item.icon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
                isActive ? 'text-primary-600' : 'text-slate-400'
              }`} />
              <div className="flex-1 min-w-0">
                <div className={`font-medium ${isActive ? 'text-primary-700' : 'text-slate-900'}`}>
                  {item.label}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {item.description}
                </div>
              </div>
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-8 p-4 bg-primary-50/50 border border-primary-200/60 rounded-xl">
        <p className="text-sm text-primary-800">
          <strong>{t('tip')}:</strong> {t('tipDescription')}
        </p>
      </div>
    </>
  );

  // Find current page label for mobile header
  const currentPage = settingsNavItems.find(item => location.pathname === item.to);

  return (
    <div className="h-full flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between p-4 border-b border-slate-200/60 bg-white">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-slate-700" />
          <span className="font-semibold text-slate-900">
            {currentPage?.label || t('title')}
          </span>
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>

      {/* Mobile Drawer Overlay */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Drawer */}
      <div
        className={`lg:hidden fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-slate-50 z-50 transform transition-transform duration-300 ease-out ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200/60">
          <span className="font-semibold text-slate-900">{t('title')}</span>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto h-[calc(100%-60px)]">
          <SidebarContent />
        </div>
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden lg:block w-72 bg-slate-50/50 border-r border-slate-200/60 p-6 flex-shrink-0">
        <SidebarContent />
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-y-auto bg-white">
        <Outlet />
      </div>
    </div>
  );
};

export default SettingsLayout;
