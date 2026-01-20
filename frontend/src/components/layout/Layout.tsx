import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import { useUiStore } from '../../store/uiStore';
import { SubscriptionProvider } from '../../contexts/SubscriptionContext';
import { cn } from '../../lib/utils';

const Layout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { isSidebarCollapsed } = useUiStore();
  const location = useLocation();

  // Hide sidebar on HomePage
  const shouldHideSidebar = location.pathname === '/home';

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const closeSidebar = () => {
    setIsSidebarOpen(false);
  };

  return (
    <SubscriptionProvider>
      <div className="flex h-screen overflow-hidden">
        {/* Mobile overlay */}
        {!shouldHideSidebar && isSidebarOpen && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
            onClick={closeSidebar}
          />
        )}

        {/* Sidebar - hidden on HomePage */}
        {!shouldHideSidebar && (
          <Sidebar isOpen={isSidebarOpen} onClose={closeSidebar} />
        )}

      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300`}>
        <Header onMenuClick={shouldHideSidebar ? undefined : toggleSidebar} />
        <main className={cn(
          'flex-1 overflow-y-auto bg-background relative',
          shouldHideSidebar ? '' : 'p-4 md:p-6'
        )}>
          <Outlet />
          {import.meta.env.VITE_APP_VERSION && (
            <div
              className="fixed bottom-3 right-3 text-xs bg-white px-2 py-1 rounded shadow-sm border border-gray-200 z-10 cursor-help hover:shadow-md transition-shadow"
              title={`Version: ${import.meta.env.VITE_APP_VERSION}\nCommit: ${import.meta.env.VITE_COMMIT_SHA || 'N/A'}\nBuilt: ${import.meta.env.VITE_BUILD_TIME ? new Date(import.meta.env.VITE_BUILD_TIME).toLocaleString() : 'N/A'}`}
            >
              <div className="text-gray-600 font-medium">
                v{import.meta.env.VITE_APP_VERSION.replace('v', '')}
              </div>
              {import.meta.env.VITE_BUILD_TIME && (
                <div className="text-gray-400 text-[10px] mt-0.5">
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
