import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import VerifyEmailPage from './pages/auth/VerifyEmailPage';
import ProfilePage from './pages/profile/ProfilePage';
import CustomersPage from './pages/customers/CustomersPage';
import CustomerDetailPage from './pages/customers/CustomerDetailPage';
import QRMenuPage from './pages/qr-menu/QRMenuPage';
import CartPage from './pages/qr-menu/CartPage';
import OrderTrackingPage from './pages/qr-menu/OrderTrackingPage';
import LoyaltyPage from './pages/qr-menu/LoyaltyPage';
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
import SubscriptionPaymentPage from './pages/subscription/SubscriptionPaymentPage';
import PaymentSuccessPage from './pages/subscription/PaymentSuccessPage';
import PaymentFailedPage from './pages/subscription/PaymentFailedPage';
import SettingsLayout from './pages/settings/SettingsLayout';
import POSSettingsPage from './pages/settings/POSSettingsPage';
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

function App() {
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const isAuthenticated = useAuthStore((state) => !!state.accessToken);

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
          <Route path="desktop" element={<DesktopAppSettingsPage />} />
          <Route path="integrations" element={<IntegrationsSettingsPage />} />
        </Route>

        {/* Legacy redirects */}
        <Route path="/admin/pos-settings" element={<Navigate to="/admin/settings/pos" replace />} />
        <Route path="/subscription/manage" element={<Navigate to="/admin/settings/subscription" replace />} />

        {/* Subscription pages */}
        <Route path="/subscription/plans" element={<SubscriptionPlansPage />} />
        <Route path="/subscription/change-plan" element={<ChangePlanPage />} />
        <Route path="/subscription/payment" element={<SubscriptionPaymentPage />} />
        <Route path="/subscription/payment/success" element={<PaymentSuccessPage />} />
        <Route path="/subscription/payment/failed" element={<PaymentFailedPage />} />
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
