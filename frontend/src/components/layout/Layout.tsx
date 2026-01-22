import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Header from './Header';
import Sidebar from './Sidebar';
import { useUiStore } from '../../store/uiStore';
import { SubscriptionProvider } from '../../contexts/SubscriptionContext';
import { RTL_LANGUAGES } from '../../i18n/config';

const Layout = () => {
  const { i18n } = useTranslation();
  const isRTL = RTL_LANGUAGES.includes(i18n.language);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { isSidebarCollapsed } = useUiStore();

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const closeSidebar = () => {
    setIsSidebarOpen(false);
  };

  return (
    <SubscriptionProvider>
      <div className="flex h-screen overflow-hidden bg-slate-50">
        {/* Mobile overlay */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden transition-opacity"
            onClick={closeSidebar}
          />
        )}

        <Sidebar isOpen={isSidebarOpen} onClose={closeSidebar} isRTL={isRTL} />

        <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${isRTL ? 'md:order-1' : ''}`}>
          <Header onMenuClick={toggleSidebar} />
          <main className="flex-1 overflow-y-auto bg-slate-50/50 p-4 md:p-6 lg:p-8 relative">
            <Outlet />
            {import.meta.env.VITE_APP_VERSION && (
              <div
                className="fixed bottom-4 right-4 text-xs bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-sm border border-slate-200/60 z-10 cursor-help hover:shadow-md transition-all duration-200"
                title={`Version: ${import.meta.env.VITE_APP_VERSION}\nCommit: ${import.meta.env.VITE_COMMIT_SHA || 'N/A'}\nBuilt: ${import.meta.env.VITE_BUILD_TIME ? new Date(import.meta.env.VITE_BUILD_TIME).toLocaleString() : 'N/A'}`}
              >
                <div className="text-slate-600 font-medium">
                  v{import.meta.env.VITE_APP_VERSION.replace('v', '')}
                </div>
                {import.meta.env.VITE_BUILD_TIME && (
                  <div className="text-slate-400 text-[10px] mt-0.5">
                    {new Date(import.meta.env.VITE_BUILD_TIME).toLocaleDateString()} {new Date(import.meta.env.VITE_BUILD_TIME).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </SubscriptionProvider>
  );
};

export default Layout;
