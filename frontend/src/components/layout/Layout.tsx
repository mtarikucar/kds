import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import { useUiStore } from '../../store/uiStore';

const Layout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { isSidebarCollapsed } = useUiStore();

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const closeSidebar = () => {
    setIsSidebarOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={closeSidebar}
        />
      )}

      <Sidebar isOpen={isSidebarOpen} onClose={closeSidebar} />

      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300`}>
        <Header onMenuClick={toggleSidebar} />
        <main className="flex-1 overflow-y-auto bg-gray-50 p-4 md:p-6 relative">
          <Outlet />
          {import.meta.env.VITE_APP_VERSION && (
            <div className="fixed bottom-3 right-3 text-xs text-gray-400 bg-white px-2 py-1 rounded shadow-sm border border-gray-200 z-10">
              v{import.meta.env.VITE_APP_VERSION.replace('v', '')}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default Layout;
