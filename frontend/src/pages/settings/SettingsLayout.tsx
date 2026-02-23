import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings, CreditCard, Monitor, Plug, Download, Menu, X, QrCode, FileText, Palette, CalendarClock } from 'lucide-react';

const SettingsLayout = () => {
  const { t } = useTranslation('settings');
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const settingsNavItems = [
    {
      to: '/admin/settings/subscription',
      icon: CreditCard,
      label: t('subscription'),
    },
    {
      to: '/admin/settings/pos',
      icon: Monitor,
      label: t('pos'),
    },
    {
      to: '/admin/settings/qr-menu',
      icon: QrCode,
      label: t('nav.qrMenu'),
    },
    {
      to: '/admin/settings/reports',
      icon: FileText,
      label: t('nav.reports'),
    },
    {
      to: '/admin/settings/branding',
      icon: Palette,
      label: t('nav.branding'),
    },
    {
      to: '/admin/settings/desktop',
      icon: Download,
      label: t('desktopApp'),
    },
    {
      to: '/admin/settings/integrations',
      icon: Plug,
      label: t('integrationsLabel'),
    },
    {
      to: '/admin/settings/reservations',
      icon: CalendarClock,
      label: t('nav.reservations'),
    },
  ];

  const handleNavClick = () => {
    setIsMobileMenuOpen(false);
  };

  const SidebarContent = () => (
    <>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-slate-600" />
          <h2 className="text-base font-heading font-semibold text-slate-900">{t('title')}</h2>
        </div>
      </div>

      <nav className="space-y-0.5" data-tour="settings-nav">
        {settingsNavItems.map((item) => {
          const isActive = location.pathname === item.to ||
            (item.to !== '/admin/settings/subscription' && location.pathname.startsWith(item.to));
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={handleNavClick}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <item.icon className={`h-4 w-4 flex-shrink-0 ${
                isActive ? 'text-primary-600' : 'text-slate-400'
              }`} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
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
      <div className="hidden lg:block w-52 bg-slate-50/50 border-r border-slate-200/60 p-4 flex-shrink-0">
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
