import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { MarketingLayout, MarketingProtectedRoute } from './features/marketing/components';
import { MarketingRole } from './features/marketing/types';

// Same lazy-loaded page set and route map as the monorepo App.tsx — only the
// marketing sub-tree survived the split, with / redirecting to the dashboard.
const MarketingLoginPage = lazy(() => import('./pages/marketing/MarketingLoginPage'));
const MarketingDashboardPage = lazy(() => import('./pages/marketing/MarketingDashboardPage'));
const LeadsPage = lazy(() => import('./pages/marketing/LeadsPage'));
const LeadDetailPage = lazy(() => import('./pages/marketing/LeadDetailPage'));
const CreateLeadPage = lazy(() => import('./pages/marketing/CreateLeadPage'));
const TasksPage = lazy(() => import('./pages/marketing/TasksPage'));
const CalendarPage = lazy(() => import('./pages/marketing/CalendarPage'));
const OffersPage = lazy(() => import('./pages/marketing/OffersPage'));
const MarketingReportsPage = lazy(() => import('./pages/marketing/ReportsPage'));
const CommissionsPage = lazy(() => import('./pages/marketing/CommissionsPage'));
const MarketingUsersPage = lazy(() => import('./pages/marketing/MarketingUsersPage'));

function PageLoader() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Navigate to="/marketing/dashboard" replace />} />

        {/* Marketing Panel Routes */}
        <Route path="/marketing/login" element={<MarketingLoginPage />} />
        <Route element={<MarketingProtectedRoute />}>
          <Route element={<MarketingLayout />}>
            <Route path="/marketing" element={<Navigate to="/marketing/dashboard" replace />} />
            <Route path="/marketing/dashboard" element={<MarketingDashboardPage />} />
            <Route path="/marketing/leads" element={<LeadsPage />} />
            <Route path="/marketing/leads/new" element={<CreateLeadPage />} />
            <Route path="/marketing/leads/:id" element={<LeadDetailPage />} />
            <Route path="/marketing/leads/:id/edit" element={<CreateLeadPage />} />
            <Route path="/marketing/tasks" element={<TasksPage />} />
            <Route path="/marketing/calendar" element={<CalendarPage />} />
            <Route path="/marketing/offers" element={<OffersPage />} />
            <Route path="/marketing/reports" element={<MarketingReportsPage />} />
            <Route path="/marketing/commissions" element={<CommissionsPage />} />
          </Route>
          {/* Manager-only sub-tree. Bare-URL navigation by a SALES_REP
              redirects to the dashboard rather than rendering the page
              and waiting for the backend 403. */}
          <Route element={<MarketingProtectedRoute requiredRole={MarketingRole.SALES_MANAGER} />}>
            <Route element={<MarketingLayout />}>
              <Route path="/marketing/users" element={<MarketingUsersPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/marketing/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
