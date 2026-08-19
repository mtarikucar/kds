import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Header from './Header';
import Sidebar from './Sidebar';
import { useUiStore } from '../../store/uiStore';
import { SubscriptionProvider } from '../../contexts/SubscriptionContext';
import { OnboardingProvider } from '../../features/onboarding';
import { DemoBanner } from '../../features/demo';
import { RTL_LANGUAGES } from '../../i18n/config';
import RenewalBanner from '../subscriptions/SubscriptionStatusBanner';
import ProfileCompletionGate from '../onboarding/ProfileCompletionGate';
import BranchSelectionGate from '../branches/BranchSelectionGate';

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
      <OnboardingProvider>
      {/* The shell owns the viewport: body never scrolls, <main> below is the
          one and only scroll container. h-dvh, not h-screen — on iOS/Android
          100vh is taller than the visible viewport by the URL-bar height, and
          since body can't scroll, that difference used to park the bottom of
          every page permanently under the browser chrome. */}
      <div className="flex h-dvh overflow-hidden bg-slate-50">
        {/* Mobile overlay */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden transition-opacity"
            onClick={closeSidebar}
          />
        )}

        <Sidebar isOpen={isSidebarOpen} onClose={closeSidebar} isRTL={isRTL} />

        {/* min-w-0 so this column may shrink below the intrinsic width of its
            widest child. Without it the header's action cluster pushed the
            column wider than the viewport and — since the column clips —
            the logout button simply disappeared off the right edge at
            tablet widths. */}
        <div className={`flex-1 min-w-0 flex flex-col overflow-hidden transition-all duration-300 ${isRTL ? 'md:order-1' : ''}`}>
          <Header onMenuClick={toggleSidebar} />
          {/* Demo-mode banner — renders null unless authStore.demoMode is on. */}
          <DemoBanner />
          {/* Status banner — sits between header and main content. Renders
              null when there's nothing to surface, so layout doesn't shift. */}
          <RenewalBanner />
          {/* THE PAGE-HEIGHT CONTRACT.
              This element is the app's only scroll container, and its height
              is 100dvh minus the header minus whichever of the banners above
              happen to be rendering — a number no page can compute for
              itself. So a page that wants to fill the content area exactly
              (POS, KDS, floor plan, the menu workspace) must NOT guess with
              `h-[calc(100vh-Xrem)]`; it puts `h-full min-h-0` on its root
              instead. height:100% resolves against this box's content area,
              which stays correct at every breakpoint, with or without the
              banners, and on mobile where 100vh lies.
              min-h-0 keeps this a shrinkable flex item so tall page content
              scrolls here rather than pushing the box past the shell. */}
          <main className="flex-1 min-h-0 min-w-0 overflow-y-auto bg-slate-50/50 p-4 md:p-6 lg:p-8 relative">
            {/* Onboarding gates: first ensure the account is complete (phone —
                e.g. a social signup → /welcome), then enforce the trial lock
                (TRIAL_ENDED → plan selection). */}
            <ProfileCompletionGate>
              <BranchSelectionGate>
                  <Outlet />
                </BranchSelectionGate>
            </ProfileCompletionGate>
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
      </OnboardingProvider>
    </SubscriptionProvider>
  );
};

export default Layout;
