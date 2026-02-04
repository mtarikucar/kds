import { useState, useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import VerifyEmailPage from './pages/auth/VerifyEmailPage';

// SuperAdmin Pages
import SuperAdminLoginPage from './pages/superadmin/SuperAdminLoginPage';
import SuperAdmin2FAPage from './pages/superadmin/SuperAdmin2FAPage';
import SuperAdminDashboardPage from './pages/superadmin/SuperAdminDashboardPage';
import TenantsPage from './pages/superadmin/TenantsPage';
import TenantDetailPage from './pages/superadmin/TenantDetailPage';
import AllUsersPage from './pages/superadmin/AllUsersPage';
import PlansPage from './pages/superadmin/PlansPage';
import SubscriptionsPage from './pages/superadmin/SubscriptionsPage';
import AuditLogsPage from './pages/superadmin/AuditLogsPage';
import SuperAdminSettingsPage from './pages/superadmin/SuperAdminSettingsPage';
import { SuperAdminLayout, SuperAdminProtectedRoute } from './features/superadmin/components';
import ProfilePage from './pages/profile/ProfilePage';
import CustomersPage from './pages/customers/CustomersPage';
import CustomerDetailPage from './pages/customers/CustomerDetailPage';
import QRMenuPage from './pages/qr-menu/QRMenuPage';
import CartPage from './pages/qr-menu/CartPage';
import OrderTrackingPage from './pages/qr-menu/OrderTrackingPage';
import LoyaltyPage from './pages/qr-menu/LoyaltyPage';
import SubdomainQRMenuPage from './pages/qr-menu/SubdomainQRMenuPage';
import SubdomainCartPage from './pages/qr-menu/SubdomainCartPage';
import SubdomainOrdersPage from './pages/qr-menu/SubdomainOrdersPage';
import SubdomainLoyaltyPage from './pages/qr-menu/SubdomainLoyaltyPage';
import TermsOfServicePage from './pages/legal/TermsOfServicePage';
import PrivacyPolicyPage from './pages/legal/PrivacyPolicyPage';
import DashboardPage from './pages/DashboardPage';
import POSPage from './pages/pos/POSPage';
import KitchenDisplayPage from './pages/kitchen/KitchenDisplayPage';
import MenuManagementPage from './pages/admin/MenuManagementPage';
import TableManagementPage from './pages/admin/TableManagementPage';
import UserManagementPage from './pages/admin/UserManagementPage';
import QRManagementPage from './pages/admin/QRManagementPage';
import ReportsPage from './pages/admin/ReportsPage';
import SubscriptionPlansPage from './pages/subscription/SubscriptionPlansPage';
import ChangePlanPage from './pages/subscription/ChangePlanPage';
import SubscriptionContactPage from './pages/subscription/SubscriptionContactPage';
import SettingsLayout from './pages/settings/SettingsLayout';
import POSSettingsPage from './pages/settings/POSSettingsPage';
import QRMenuSettingsPage from './pages/settings/QRMenuSettingsPage';
import ReportsSettingsPage from './pages/settings/ReportsSettingsPage';
import BrandingSettingsPage from './pages/settings/BrandingSettingsPage';
import SubscriptionSettingsPage from './pages/settings/SubscriptionSettingsPage';
import IntegrationsSettingsPage from './pages/settings/IntegrationsSettingsPage';
import DesktopAppSettingsPage from './pages/settings/DesktopAppSettingsPage';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { UpdateDialog } from './components/UpdateDialog';
import { useAutoUpdate } from './hooks/useAutoUpdate';
import { useNotificationSocket } from './features/notifications/notificationsApi';
import { useAuthStore } from './store/authStore';
import { UserRole } from './types';
import { detectSubdomain } from './utils/subdomain';

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
      <>
        <Routes>
          <Route path="/" element={<SubdomainQRMenuPage subdomain={subdomainInfo.subdomain} />} />
          <Route path="/cart" element={<SubdomainCartPage subdomain={subdomainInfo.subdomain} />} />
          <Route path="/orders" element={<SubdomainOrdersPage subdomain={subdomainInfo.subdomain} />} />
          <Route path="/loyalty" element={<SubdomainLoyaltyPage subdomain={subdomainInfo.subdomain} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </>
    );
  }

  return (
    <>
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
        </Route>

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
          <Route path="/superadmin/settings" element={<SuperAdminSettingsPage />} />
        </Route>
      </Route>
    </Routes>

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
