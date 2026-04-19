import { useState, useMemo, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import VerifyEmailPage from './pages/auth/VerifyEmailPage';

// SuperAdmin Pages (lazy-loaded)
const SuperAdminLoginPage = lazy(() => import('./pages/superadmin/SuperAdminLoginPage'));
const SuperAdmin2FAPage = lazy(() => import('./pages/superadmin/SuperAdmin2FAPage'));
const SuperAdminDashboardPage = lazy(() => import('./pages/superadmin/SuperAdminDashboardPage'));
const TenantsPage = lazy(() => import('./pages/superadmin/TenantsPage'));
const TenantDetailPage = lazy(() => import('./pages/superadmin/TenantDetailPage'));
const AllUsersPage = lazy(() => import('./pages/superadmin/AllUsersPage'));
const PlansPage = lazy(() => import('./pages/superadmin/PlansPage'));
const SubscriptionsPage = lazy(() => import('./pages/superadmin/SubscriptionsPage'));
const AuditLogsPage = lazy(() => import('./pages/superadmin/AuditLogsPage'));
const SuperAdminSettingsPage = lazy(() => import('./pages/superadmin/SuperAdminSettingsPage'));
const TerminalPage = lazy(() => import('./pages/superadmin/TerminalPage'));
import { SuperAdminLayout, SuperAdminProtectedRoute } from './features/superadmin/components';

// Marketing Panel Pages (lazy-loaded)
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
import { MarketingLayout, MarketingProtectedRoute } from './features/marketing/components';
import ProfilePage from './pages/profile/ProfilePage';
import CustomersPage from './pages/customers/CustomersPage';
import CustomerDetailPage from './pages/customers/CustomerDetailPage';

// QR Menu Pages (lazy-loaded - customer-facing)
const QRMenuPage = lazy(() => import('./pages/qr-menu/QRMenuPage'));
const CartPage = lazy(() => import('./pages/qr-menu/CartPage'));
const OrderTrackingPage = lazy(() => import('./pages/qr-menu/OrderTrackingPage'));
const LoyaltyPage = lazy(() => import('./pages/qr-menu/LoyaltyPage'));
const SubdomainQRMenuPage = lazy(() => import('./pages/qr-menu/SubdomainQRMenuPage'));
const SubdomainCartPage = lazy(() => import('./pages/qr-menu/SubdomainCartPage'));
const SubdomainOrdersPage = lazy(() => import('./pages/qr-menu/SubdomainOrdersPage'));
const SubdomainLoyaltyPage = lazy(() => import('./pages/qr-menu/SubdomainLoyaltyPage'));

const PublicReservationPage = lazy(() => import('./pages/reservations/PublicReservationPage'));
const ReservationLookupPage = lazy(() => import('./pages/reservations/ReservationLookupPage'));
const TermsOfServicePage = lazy(() => import('./pages/legal/TermsOfServicePage'));
const PrivacyPolicyPage = lazy(() => import('./pages/legal/PrivacyPolicyPage'));
import DashboardPage from './pages/DashboardPage';
import POSPage from './pages/pos/POSPage';
import KitchenDisplayPage from './pages/kitchen/KitchenDisplayPage';

// Admin Pages (lazy-loaded)
const MenuManagementPage = lazy(() => import('./pages/admin/MenuManagementPage'));
const TableManagementPage = lazy(() => import('./pages/admin/TableManagementPage'));
const UserManagementPage = lazy(() => import('./pages/admin/UserManagementPage'));
const QRManagementPage = lazy(() => import('./pages/admin/QRManagementPage'));
const ReportsPage = lazy(() => import('./pages/admin/ReportsPage'));
const AnalyticsPage = lazy(() => import('./pages/admin/AnalyticsPage'));
const ReservationsPage = lazy(() => import('./pages/admin/ReservationsPage'));
const PersonnelManagementPage = lazy(() => import('./pages/admin/PersonnelManagementPage'));
const StockManagementPage = lazy(() => import('./pages/admin/StockManagementPage'));

// Subscription & Settings Pages (lazy-loaded)
const SubscriptionPlansPage = lazy(() => import('./pages/subscription/SubscriptionPlansPage'));
const ChangePlanPage = lazy(() => import('./pages/subscription/ChangePlanPage'));
const SubscriptionContactPage = lazy(() => import('./pages/subscription/SubscriptionContactPage'));
const SettingsLayout = lazy(() => import('./pages/settings/SettingsLayout'));
const POSSettingsPage = lazy(() => import('./pages/settings/POSSettingsPage'));
const QRMenuSettingsPage = lazy(() => import('./pages/settings/QRMenuSettingsPage'));
const ReportsSettingsPage = lazy(() => import('./pages/settings/ReportsSettingsPage'));
const BrandingSettingsPage = lazy(() => import('./pages/settings/BrandingSettingsPage'));
const SubscriptionSettingsPage = lazy(() => import('./pages/settings/SubscriptionSettingsPage'));
const IntegrationsSettingsPage = lazy(() => import('./pages/settings/IntegrationsSettingsPage'));
const DesktopAppSettingsPage = lazy(() => import('./pages/settings/DesktopAppSettingsPage'));
const ReservationSettingsPage = lazy(() => import('./pages/settings/ReservationSettingsPage'));
const DeliveryPlatformsSettingsPage = lazy(() => import('./pages/settings/DeliveryPlatformsSettingsPage'));
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { UpdateDialog } from './components/UpdateDialog';
import { useAutoUpdate } from './hooks/useAutoUpdate';
import { useNotificationSocket } from './features/notifications/notificationsApi';
import { useAuthStore } from './store/authStore';
import { UserRole } from './types';
import { detectSubdomain } from './utils/subdomain';

// Dev-only pages
const FloorPlan3DPage = import.meta.env.DEV
  ? lazy(() => import('./pages/dev/FloorPlan3DPage'))
  : null;

function App() {
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const isAuthenticated = useAuthStore((state) => !!state.accessToken);

  // Detect subdomain access
  const subdomainInfo = useMemo(() => detectSubdomain(), []);

  // Auto-update hook - check for updates on app startup
  const updateState = useAutoUpdate(true);

  // Initialize WebSocket for real-time notifications (hook must be called unconditionally)
  useNotificationSocket();

  // Show update dialog when update is available
  if (updateState.available && !showUpdateDialog) {
    setShowUpdateDialog(true);
  }

  const handleUpdate = () => {
    updateState.downloadAndInstall();
  };

  const handleDismiss = () => {
    setShowUpdateDialog(false);
  };

  // Subdomain access - only show QR menu routes
  if (subdomainInfo.isSubdomainAccess && subdomainInfo.subdomain) {
    return (
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<SubdomainQRMenuPage subdomain={subdomainInfo.subdomain} />} />
          <Route path="/cart" element={<SubdomainCartPage subdomain={subdomainInfo.subdomain} />} />
          <Route path="/orders" element={<SubdomainOrdersPage subdomain={subdomainInfo.subdomain} />} />
          <Route path="/loyalty" element={<SubdomainLoyaltyPage subdomain={subdomainInfo.subdomain} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <>
      <Suspense fallback={null}>
      <Routes>
      {/* Public Routes */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/terms" element={<TermsOfServicePage />} />
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/qr-menu/:tenantId" element={<QRMenuPage />} />
      <Route path="/qr-menu/:tenantId/cart" element={<CartPage />} />
      <Route path="/qr-menu/:tenantId/orders" element={<OrderTrackingPage />} />
      <Route path="/qr-menu/:tenantId/loyalty" element={<LoyaltyPage />} />
      <Route path="/reserve/:tenantId" element={<PublicReservationPage />} />
      <Route path="/reserve/:tenantId/lookup" element={<ReservationLookupPage />} />

      {/* Protected Routes - All authenticated users */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      {/* Protected Routes - ADMIN, MANAGER, WAITER */}
      <Route element={<ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER]}><Layout /></ProtectedRoute>}>
        <Route path="/pos" element={<POSPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
      </Route>

      {/* Protected Routes - ADMIN, MANAGER, KITCHEN */}
      <Route element={<ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN]}><Layout /></ProtectedRoute>}>
        <Route path="/kitchen" element={<KitchenDisplayPage />} />
      </Route>

      {/* Protected Routes - ADMIN, MANAGER only (Admin pages) */}
      <Route element={<ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.MANAGER]}><Layout /></ProtectedRoute>}>
        <Route path="/admin/menu" element={<MenuManagementPage />} />
        <Route path="/admin/tables" element={<TableManagementPage />} />
        <Route path="/admin/users" element={<UserManagementPage />} />
        <Route path="/admin/qr-codes" element={<QRManagementPage />} />
        <Route path="/admin/reports" element={<ReportsPage />} />
        <Route path="/admin/analytics" element={<AnalyticsPage />} />
        <Route path="/admin/reservations" element={<ReservationsPage />} />
        <Route path="/admin/personnel" element={<PersonnelManagementPage />} />
        <Route path="/admin/stock" element={<StockManagementPage />} />

        {/* Settings Routes - Nested */}
        <Route path="/admin/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="/admin/settings/subscription" replace />} />
          <Route path="subscription" element={<SubscriptionSettingsPage />} />
          <Route path="pos" element={<POSSettingsPage />} />
          <Route path="qr-menu" element={<QRMenuSettingsPage />} />
          <Route path="reports" element={<ReportsSettingsPage />} />
          <Route path="branding" element={<BrandingSettingsPage />} />
          <Route path="desktop" element={<DesktopAppSettingsPage />} />
          <Route path="integrations" element={<IntegrationsSettingsPage />} />
          <Route path="reservations" element={<ReservationSettingsPage />} />
          <Route path="online-orders" element={<DeliveryPlatformsSettingsPage />} />
        </Route>

        {/* Dev-only routes */}
        {import.meta.env.DEV && FloorPlan3DPage && (
          <Route path="/dev/floor-plan" element={<Suspense fallback={null}><FloorPlan3DPage /></Suspense>} />
        )}

        {/* Legacy redirects */}
        <Route path="/admin/pos-settings" element={<Navigate to="/admin/settings/pos" replace />} />
        <Route path="/subscription/manage" element={<Navigate to="/admin/settings/subscription" replace />} />

        {/* Subscription pages */}
        <Route path="/subscription/plans" element={<SubscriptionPlansPage />} />
        <Route path="/subscription/change-plan" element={<ChangePlanPage />} />
        <Route path="/subscription/contact" element={<SubscriptionContactPage />} />
        {/* Legacy redirect for old payment URLs */}
        <Route path="/subscription/payment" element={<Navigate to="/subscription/plans" replace />} />
        <Route path="/subscription/payment/success" element={<Navigate to="/admin/settings/subscription" replace />} />
        <Route path="/subscription/payment/failed" element={<Navigate to="/subscription/plans" replace />} />
      </Route>

      {/* SuperAdmin Routes */}
      <Route path="/superadmin/login" element={<SuperAdminLoginPage />} />
      <Route path="/superadmin/2fa" element={<SuperAdmin2FAPage />} />
      <Route element={<SuperAdminProtectedRoute />}>
        <Route element={<SuperAdminLayout />}>
          <Route path="/superadmin" element={<Navigate to="/superadmin/dashboard" replace />} />
          <Route path="/superadmin/dashboard" element={<SuperAdminDashboardPage />} />
          <Route path="/superadmin/tenants" element={<TenantsPage />} />
          <Route path="/superadmin/tenants/:id" element={<TenantDetailPage />} />
          <Route path="/superadmin/users" element={<AllUsersPage />} />
          <Route path="/superadmin/plans" element={<PlansPage />} />
          <Route path="/superadmin/subscriptions" element={<SubscriptionsPage />} />
          <Route path="/superadmin/audit-logs" element={<AuditLogsPage />} />
          <Route path="/superadmin/terminal" element={<TerminalPage />} />
          <Route path="/superadmin/settings" element={<SuperAdminSettingsPage />} />
        </Route>
      </Route>
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
          <Route path="/marketing/users" element={<MarketingUsersPage />} />
        </Route>
      </Route>
    </Routes>
    </Suspense>

      {/* Update Dialog */}
      {showUpdateDialog && (
        <UpdateDialog
          available={updateState.available}
          version={updateState.version}
          currentVersion={updateState.currentVersion}
          downloading={updateState.downloading}
          error={updateState.error}
          onUpdate={handleUpdate}
          onDismiss={handleDismiss}
        />
      )}
    </>
  );
}

export default App;
