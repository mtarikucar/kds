import { Routes, Route, Navigate } from 'react-router-dom';
import { MarketingLayout, MarketingProtectedRoute } from './features/marketing/components';
import { MarketingRole } from './features/marketing/types';
import MarketingLoginPage from './pages/marketing/MarketingLoginPage';
import MarketingDashboardPage from './pages/marketing/MarketingDashboardPage';
import LeadsPage from './pages/marketing/LeadsPage';
import CreateLeadPage from './pages/marketing/CreateLeadPage';
import LeadDetailPage from './pages/marketing/LeadDetailPage';
import TasksPage from './pages/marketing/TasksPage';
import CalendarPage from './pages/marketing/CalendarPage';
import OffersPage from './pages/marketing/OffersPage';
import ReportsPage from './pages/marketing/ReportsPage';
import CommissionsPage from './pages/marketing/CommissionsPage';
import MarketingUsersPage from './pages/marketing/MarketingUsersPage';

/**
 * Standalone marketing console — the same panel the POS app serves under
 * /app/marketing, but at the ROOT of marketing.hummytummy.com. Routes mirror
 * the POS App.tsx marketing block with the /marketing prefix stripped.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<MarketingLoginPage />} />
      <Route element={<MarketingProtectedRoute />}>
        <Route element={<MarketingLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<MarketingDashboardPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/leads/new" element={<CreateLeadPage />} />
          <Route path="/leads/:id" element={<LeadDetailPage />} />
          <Route path="/leads/:id/edit" element={<CreateLeadPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/offers" element={<OffersPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/commissions" element={<CommissionsPage />} />
        </Route>
        <Route element={<MarketingProtectedRoute requiredRole={MarketingRole.SALES_MANAGER} />}>
          <Route element={<MarketingLayout />}>
            <Route path="/users" element={<MarketingUsersPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
