import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import VerifyEmailPage from './pages/auth/VerifyEmailPage';
import ProfilePage from './pages/profile/ProfilePage';
import CustomersPage from './pages/customers/CustomersPage';
import QRMenuPage from './pages/qr-menu/QRMenuPage';
import CartPage from './pages/qr-menu/CartPage';
import OrderTrackingPage from './pages/qr-menu/OrderTrackingPage';
import { LandingPage } from './pages/LandingPage';
import DashboardPage from './pages/DashboardPage';
import POSPage from './pages/pos/POSPage';
import KitchenDisplayPage from './pages/kitchen/KitchenDisplayPage';
import MenuManagementPage from './pages/admin/MenuManagementPage';
import TableManagementPage from './pages/admin/TableManagementPage';
import UserManagementPage from './pages/admin/UserManagementPage';
import QRManagementPage from './pages/admin/QRManagementPage';
import ReportsPage from './pages/admin/ReportsPage';
import SubscriptionPlansPage from './pages/subscription/SubscriptionPlansPage';
import SubscriptionPaymentPage from './pages/subscription/SubscriptionPaymentPage';
import SettingsLayout from './pages/settings/SettingsLayout';
import POSSettingsPage from './pages/settings/POSSettingsPage';
import SubscriptionSettingsPage from './pages/settings/SubscriptionSettingsPage';
import IntegrationsSettingsPage from './pages/settings/IntegrationsSettingsPage';
import DesktopAppSettingsPage from './pages/settings/DesktopAppSettingsPage';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/qr-menu/:tenantId" element={<QRMenuPage />} />
      <Route path="/qr-menu/:tenantId/cart" element={<CartPage />} />
      <Route path="/qr-menu/:tenantId/orders" element={<OrderTrackingPage />} />

      {/* Protected Routes */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/pos" element={<POSPage />} />
        <Route path="/kitchen" element={<KitchenDisplayPage />} />
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
        <Route path="/subscription/payment" element={<SubscriptionPaymentPage />} />

        {/* Profile & Customers */}
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/customers" element={<CustomersPage />} />
      </Route>
    </Routes>
  );
}

export default App;
