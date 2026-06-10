import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
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
const MarketplaceAdminPage = lazy(() => import('./pages/superadmin/MarketplaceAdminPage'));
import { SuperAdminLayout, SuperAdminProtectedRoute } from './features/superadmin/components';

// (The marketing panel moved to the separate kds-marketing project.)
import ProfilePage from './pages/profile/ProfilePage';
import FAQPage from './pages/help/FAQPage';
import CustomersPage from './pages/customers/CustomersPage';
import CustomerDetailPage from './pages/customers/CustomerDetailPage';

// QR Menu Pages (lazy-loaded - customer-facing)
const QRMenuPage = lazy(() => import('./pages/qr-menu/QRMenuPage'));
const CartPage = lazy(() => import('./pages/qr-menu/CartPage'));
const OrderTrackingPage = lazy(() => import('./pages/qr-menu/OrderTrackingPage'));
const QrPaymentResultPage = lazy(() => import('./pages/qr-menu/QrPaymentResultPage'));
const LoyaltyPage = lazy(() => import('./pages/qr-menu/LoyaltyPage'));
const SubdomainQRMenuPage = lazy(() => import('./pages/qr-menu/SubdomainQRMenuPage'));
const SubdomainCartPage = lazy(() => import('./pages/qr-menu/SubdomainCartPage'));
const SubdomainOrdersPage = lazy(() => import('./pages/qr-menu/SubdomainOrdersPage'));
const SubdomainLoyaltyPage = lazy(() => import('./pages/qr-menu/SubdomainLoyaltyPage'));

const PublicReservationPage = lazy(() => import('./pages/reservations/PublicReservationPage'));
const ReservationLookupPage = lazy(() => import('./pages/reservations/ReservationLookupPage'));
const TermsOfServicePage = lazy(() => import('./pages/legal/TermsOfServicePage'));
const PrivacyPolicyPage = lazy(() => import('./pages/legal/PrivacyPolicyPage'));
// Subscription checkout consent links to these three; without
// matching routes the new-tab open lands on the Next.js landing
// app, gets a locale prefix from next-intl, and 404s.
const KvkkPage = lazy(() => import('./pages/legal/KvkkPage'));
const DistanceSalesPage = lazy(() => import('./pages/legal/DistanceSalesPage'));
const RefundPolicyPage = lazy(() => import('./pages/legal/RefundPolicyPage'));
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
const InvoicesPage = lazy(() => import('./pages/admin/invoices/InvoicesPage'));

// Subscription & Settings Pages (lazy-loaded)
const SubscriptionPlansPage = lazy(() => import('./pages/subscription/SubscriptionPlansPage'));
const ChangePlanPage = lazy(() => import('./pages/subscription/ChangePlanPage'));
const CheckoutPage = lazy(() => import('./pages/subscription/CheckoutPage'));
const PaymentResultPage = lazy(() => import('./pages/subscription/PaymentResultPage'));
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
const SmsSettingsPage = lazy(() => import('./pages/settings/SmsSettingsPage'));
const AccountingSettingsPage = lazy(() => import('./pages/settings/AccountingSettingsPage'));
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';
// HummyTummy Phase 3–12 admin screens.
import DevicesPage from './features/devices/DevicesPage';
import MarketplacePage from './features/marketplace/MarketplacePage';
import StorePage from './features/hardware-store/StorePage';
import HardwareOrdersListPage from './features/hardware-store/HardwareOrdersListPage';
import HardwareOrderDetailPage from './features/hardware-store/HardwareOrderDetailPage';
import ProductDetailPage from './features/hardware-store/ProductDetailPage';
import BranchesPage from './features/branches/BranchesPage';
import HealthPage from './features/health/HealthPage';
import WebhooksPage from './features/webhooks/WebhooksPage';
import BridgesPage from './features/bridges/BridgesPage';
import FiscalRecoveryPage from './features/fiscal/FiscalRecoveryPage';
import CallerFeedPage from './features/caller/CallerFeedPage';
import PlanAndAccessPage from './features/plan/PlanAndAccessPage';
import FeatureGate from './components/subscriptions/FeatureGate';
import UpsellCard from './components/subscriptions/UpsellCard';
import { UpdateDialog } from './components/UpdateDialog';
import { useAutoUpdate } from './hooks/useAutoUpdate';
import { useNotificationSocket } from './features/notifications/notificationsApi';
import { useAuthStore } from './store/authStore';
import { useBranchScopeStore } from './store/branchScopeStore';
import { UserRole } from './types';
import { detectSubdomain } from './utils/subdomain';
import { useQueryClient } from '@tanstack/react-query';

function App() {
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const isAuthenticated = useAuthStore((state) => !!state.accessToken);
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();

  // v3.0.0 — hydrate the branch scope every time the persisted user
  // changes. Cross-store side effects live HERE (component effect),
  // not inside authStore.set — the audit's High finding #9 closed.
  useEffect(() => {
    useBranchScopeStore.getState().hydrateFromUser(user);
  }, [user]);

  // v3.0.0 — invalidate every TanStack Query when the active branch
  // changes so stale data from the previous branch can't show up
  // for the staleTime window.
  useEffect(() => {
    return useBranchScopeStore.subscribe(
      (s, prev) => {
        if (s.branchId !== prev.branchId) {
          queryClient.removeQueries();
        }
      },
    );
  }, [queryClient]);

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
          <Route path="/payment-result" element={<QrPaymentResultPage subdomain={subdomainInfo.subdomain} />} />
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
      {/* Subscription checkout (CheckoutPage.tsx) opens these in a new
          tab; paths must match the docLink hrefs there exactly. */}
      <Route path="/legal/kvkk" element={<KvkkPage />} />
      <Route path="/legal/distance-sales" element={<DistanceSalesPage />} />
      <Route path="/legal/refund-policy" element={<RefundPolicyPage />} />
      <Route path="/qr-menu/:tenantId" element={<QRMenuPage />} />
      <Route path="/qr-menu/:tenantId/cart" element={<CartPage />} />
      <Route path="/qr-menu/:tenantId/orders" element={<OrderTrackingPage />} />
      <Route path="/qr-menu/:tenantId/loyalty" element={<LoyaltyPage />} />
      <Route path="/qr-menu/:tenantId/payment-result" element={<QrPaymentResultPage />} />
      <Route path="/reserve/:tenantId" element={<PublicReservationPage />} />
      <Route path="/reserve/:tenantId/lookup" element={<ReservationLookupPage />} />

      {/* Protected Routes - All authenticated users */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/help" element={<FAQPage />} />
      </Route>

      {/* Protected Routes - ADMIN, MANAGER, WAITER */}
      <Route element={<ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER]}><Layout /></ProtectedRoute>}>
        {/* v3.0.0 — POS is tier-gated (BASIC+). FREE plans (post-trial
            fallback) see the UpsellCard; backend pos-settings endpoints
            also return 403 for these tenants. Sidebar item is hidden
            via the same posAccess feature flag below. */}
        <Route path="/pos" element={
          <FeatureGate feature="posAccess" fallback={<UpsellCard planName="BASIC" />}>
            <POSPage />
          </FeatureGate>
        } />
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
        {/* v2.8.88 page-root FeatureGate: direct URL access shows an
            upsell instead of 403. Each fallback links to the matching
            marketplace add-on. */}
        <Route path="/admin/reports" element={
          <FeatureGate feature="advancedReports" fallback={<UpsellCard addOnCode="advanced_reports" />}>
            <ReportsPage />
          </FeatureGate>
        } />
        <Route path="/admin/analytics" element={
          <FeatureGate feature="advancedReports" fallback={<UpsellCard addOnCode="advanced_reports" />}>
            <AnalyticsPage />
          </FeatureGate>
        } />
        <Route path="/admin/reservations" element={
          <FeatureGate feature="reservationSystem" fallback={<UpsellCard planName="PRO" />}>
            <ReservationsPage />
          </FeatureGate>
        } />
        <Route path="/admin/personnel" element={
          <FeatureGate feature="personnelManagement" fallback={<UpsellCard planName="PRO" />}>
            <PersonnelManagementPage />
          </FeatureGate>
        } />
        <Route path="/admin/stock" element={
          <FeatureGate feature="inventoryTracking" fallback={<UpsellCard planName="BASIC" />}>
            <StockManagementPage />
          </FeatureGate>
        } />
        <Route path="/admin/invoices" element={<InvoicesPage />} />

        {/* Settings Routes - Nested */}
        <Route path="/admin/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="/admin/settings/pos" replace />} />
          {/* v3.0.5: the "Abonelik" tab was removed from Settings — it
              duplicated the top-level Plan & Erişim page (/admin/plan). The
              billing detail page (invoices / cancel / reactivate / scheduled
              downgrade) now lives standalone at /subscription/manage, linked
              from Plan & Erişim. This old settings URL redirects there so any
              existing bookmark keeps working. */}
          <Route path="subscription" element={<Navigate to="/subscription/manage" replace />} />
          <Route path="pos" element={<POSSettingsPage />} />
          <Route path="qr-menu" element={<QRMenuSettingsPage />} />
          <Route path="reports" element={<ReportsSettingsPage />} />
          <Route path="branding" element={
            <FeatureGate feature="customBranding" fallback={<UpsellCard planName="PRO" />}>
              <BrandingSettingsPage />
            </FeatureGate>
          } />
          {/* v3.0.6: desktop app moved to a standalone sidebar destination
              (/admin/desktop). Redirect the old Settings sub-tab URL. */}
          <Route path="desktop" element={<Navigate to="/admin/desktop" replace />} />
          {/* v2.8.91: settings sub-pages now wrapped in FeatureGate so
              direct URL hits show UpsellCard instead of an empty page +
              403 toast on every backend call. */}
          <Route path="integrations" element={
            <FeatureGate feature="apiAccess" fallback={<UpsellCard addOnCode="api_access" planName="BUSINESS" />}>
              <IntegrationsSettingsPage />
            </FeatureGate>
          } />
          {/* v3.0.6: webhooks moved from the top-level sidebar (/admin/webhooks)
              into Settings — enterprise/developer feature, same apiAccess gate. */}
          <Route path="webhooks" element={
            <FeatureGate feature="apiAccess" fallback={<UpsellCard addOnCode="api_access" planName="BUSINESS" />}>
              <WebhooksPage />
            </FeatureGate>
          } />
          <Route path="reservations" element={
            <FeatureGate feature="reservationSystem" fallback={<UpsellCard planName="PRO" />}>
              <ReservationSettingsPage />
            </FeatureGate>
          } />
          <Route path="sms" element={
            <FeatureGate integration={{ domain: 'sms' }} fallback={<UpsellCard addOnCode="integration_sms" />}>
              <SmsSettingsPage />
            </FeatureGate>
          } />
          <Route path="online-orders" element={
            <FeatureGate feature="deliveryIntegration" fallback={<UpsellCard addOnCode="delivery_yemeksepeti" planName="PRO" />}>
              <DeliveryPlatformsSettingsPage />
            </FeatureGate>
          } />
          <Route path="accounting" element={
            <FeatureGate integration={{ domain: 'accounting' }} fallback={<UpsellCard addOnCode="integration_efatura" />}>
              <AccountingSettingsPage />
            </FeatureGate>
          } />
        </Route>

        {/* Legacy redirects */}
        <Route path="/admin/pos-settings" element={<Navigate to="/admin/settings/pos" replace />} />
        <Route path="/subscription/manage" element={<SubscriptionSettingsPage />} />

        {/* Subscription pages */}
        <Route path="/subscription/plans" element={<SubscriptionPlansPage />} />
        <Route path="/subscription/change-plan" element={<ChangePlanPage />} />
        <Route path="/subscription/checkout" element={<CheckoutPage />} />
        <Route path="/subscription/success" element={<PaymentResultPage outcome="success" />} />
        <Route path="/subscription/fail" element={<PaymentResultPage outcome="failed" />} />
        {/* Legacy redirect for old payment URLs */}
        <Route path="/subscription/payment" element={<Navigate to="/subscription/plans" replace />} />
        <Route path="/subscription/payment/success" element={<Navigate to="/subscription/success" replace />} />
        <Route path="/subscription/payment/failed" element={<Navigate to="/subscription/fail" replace />} />

        {/* HummyTummy Phase 3–12: devices, marketplace, hardware store, branches, health */}
        <Route path="/admin/devices" element={<DevicesPage />} />
        <Route path="/admin/marketplace" element={<MarketplacePage />} />
        <Route path="/admin/store" element={<StorePage />} />
        {/* v2.8.87: rich product/service detail page (real route, not modal). */}
        <Route path="/admin/store/:sku" element={<ProductDetailPage />} />
        {/* v2.8.84: tenant order history + detail. */}
        <Route path="/admin/hardware-orders" element={<HardwareOrdersListPage />} />
        <Route path="/admin/hardware-orders/:id" element={<HardwareOrderDetailPage />} />
        <Route path="/admin/branches" element={
          <FeatureGate feature="multiLocation" fallback={<UpsellCard addOnCode="extra_branch" planName="PRO" />}>
            <BranchesPage />
          </FeatureGate>
        } />
        <Route path="/admin/health" element={<HealthPage />} />
        <Route path="/admin/bridges" element={<BridgesPage />} />
        {/* v3.0.6: webhooks now lives under Settings (/admin/settings/webhooks).
            Redirect the old top-level URL so existing links keep working. */}
        <Route path="/admin/webhooks" element={<Navigate to="/admin/settings/webhooks" replace />} />
        <Route path="/admin/fiscal-recovery" element={
          <FeatureGate integration={{ domain: 'fiscal' }} fallback={<UpsellCard addOnCode="fiscal_hugin" />}>
            <FiscalRecoveryPage />
          </FeatureGate>
        } />
        <Route path="/admin/caller-feed" element={
          <FeatureGate integration={{ domain: 'caller' }} fallback={<UpsellCard addOnCode="caller_id_integration" />}>
            <CallerFeedPage />
          </FeatureGate>
        } />
        {/* v2.8.88: top-level Plan & Erişim page — plan + quota + active add-ons. */}
        <Route path="/admin/plan" element={<PlanAndAccessPage />} />
        {/* v3.0.6: Desktop app as a standalone sidebar destination (moved out of
            the Settings sub-tabs), mirroring Plan & Erişim. */}
        <Route path="/admin/desktop" element={<DesktopAppSettingsPage />} />
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
          <Route path="/superadmin/marketplace" element={<MarketplaceAdminPage />} />
          <Route path="/superadmin/subscriptions" element={<SubscriptionsPage />} />
          <Route path="/superadmin/audit-logs" element={<AuditLogsPage />} />
          <Route path="/superadmin/settings" element={<SuperAdminSettingsPage />} />
        </Route>
      </Route>
      {/* Marketing panel routes removed — it is now a standalone app at
          marketing.hummytummy.com; nginx 301-redirects /marketing/* there. */}
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
